/**
 * Tests d'intégration de la file BullMQ contre un VRAI Redis : producteur + worker, nouvelles tentatives, échecs
 * métier vs techniques, arrêt propre, Redis injoignable.
 */
import type { Redis } from "ioredis";
import type { Worker } from "bullmq";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProcessTransformJob } from "../../src/application/use-cases/process-transform-job.js";
import { TransformImage } from "../../src/application/use-cases/transform-image.js";
import { UploadImage } from "../../src/application/use-cases/upload-image.js";
import { TransformJob } from "../../src/domain/entities/transform-job.js";
import { isErr, isOk } from "../../src/domain/shared/result.js";
import { createQueueConnection, createWorkerConnection } from "../../src/infrastructure/queue/bull-connection.js";
import { BullMqTransformJobQueue } from "../../src/infrastructure/queue/bullmq-transform-job-queue.js";
import { startTransformWorker } from "../../src/infrastructure/queue/transform-worker.js";
import { FakeImageProcessor } from "../fakes/fake-image-processor.js";
import { InMemoryFileStorage } from "../fakes/in-memory-file-storage.js";
import { InMemoryImageRepository } from "../fakes/in-memory-image-repository.js";
import { InMemoryTransformCache } from "../fakes/in-memory-transform-cache.js";
import { InMemoryTransformJobRepository } from "../fakes/in-memory-transform-job-repository.js";
import { createTestRedis, flushTestRedis, testRedisUrl } from "../helpers/test-redis.js";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("contenu")]);
const ATTEMPTS = 3;

let redis: Redis; // pour vider la base de test
let producerConnection: Redis;
let workerConnection: Redis;
let queue: BullMqTransformJobQueue;
let worker: Worker | null = null;
let images: InMemoryImageRepository;
let jobs: InMemoryTransformJobRepository;
let processor: FakeImageProcessor;
let sourceId: string;

/** Attend qu'une condition devienne vraie (les jobs sont traités en arrière-plan). */
async function waitUntil(condition: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("condition non atteinte dans le délai");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
const statusOf = (id: string): string | undefined => jobs.jobs.get(id)?.status;

async function enqueueJob(transformations: Parameters<typeof TransformJob.create>[0]["transformations"], ownerId = "owner"): Promise<TransformJob> {
  const job = TransformJob.create({ ownerId, sourceImageId: sourceId, transformations });
  await jobs.save(job);
  const queued = await queue.enqueue(job.id);
  if (isErr(queued)) throw new Error("mise en file échouée");
  return job;
}

beforeAll(async () => {
  redis = await createTestRedis();
});
beforeEach(async () => {
  await flushTestRedis(redis);
  producerConnection = createQueueConnection(testRedisUrl());
  workerConnection = createWorkerConnection(testRedisUrl());
  queue = new BullMqTransformJobQueue(producerConnection, { attempts: ATTEMPTS, backoffMs: 20 });

  const storage = new InMemoryFileStorage();
  processor = new FakeImageProcessor();
  images = new InMemoryImageRepository();
  jobs = new InMemoryTransformJobRepository();
  const uploaded = await new UploadImage(storage, processor, images, { maxBytes: 1000, maxPixelsSide: 8000 }).execute({ ownerId: "owner", data: JPEG });
  if (!isOk(uploaded)) throw new Error("upload de test échoué");
  sourceId = uploaded.value.id;
  const transform = new TransformImage(images, storage, processor, new InMemoryTransformCache(), { maxPixelsSide: 8000 });
  worker = startTransformWorker(workerConnection, new ProcessTransformJob(jobs, transform), { concurrency: 2 });
  await worker.waitUntilReady();
});
afterEach(async () => {
  await worker?.close();
  worker = null;
  await queue.close();
  producerConnection.disconnect();
  workerConnection.disconnect();
});
afterAll(async () => {
  await flushTestRedis(redis);
  redis.disconnect();
});

describe("file BullMQ : traitement", () => {
  it("un job mis en file est traité par le worker : completed, avec un dérivé créé", async () => {
    const job = await enqueueJob({ rotate: 90 });
    await waitUntil(() => statusOf(job.id) === "completed");
    const done = jobs.jobs.get(job.id);
    expect(images.images.find((image) => image.id === done?.props.resultImageId)?.originalId).toBe(sourceId);
    expect(done?.props.attempts).toBe(1);
  });

  it("plusieurs jobs sont tous traités (concurrence 2)", async () => {
    const all = await Promise.all([enqueueJob({ rotate: 90 }), enqueueJob({ rotate: 180 }), enqueueJob({ rotate: 270 }), enqueueJob({ flip: true })]);
    await waitUntil(() => all.every((job) => statusOf(job.id) === "completed"));
    expect(images.images).toHaveLength(1 + 4);
  });

  it("la file ne transporte que l'identifiant : le worker lit les paramètres en base (jamais dans Redis)", async () => {
    const raw = createWorkerConnection(testRedisUrl());
    try {
      await worker?.close(); // on fige le traitement pour inspecter le contenu du job avant qu'il soit pris
      worker = null;
      const job = await enqueueJob({ rotate: 90, watermark: { text: "secret" } });
      const keys = await raw.keys("ips:bull:transform-image:*");
      const hash = await raw.hgetall(`ips:bull:transform-image:${job.id}`);
      expect(keys.length).toBeGreaterThan(0);
      expect(hash["data"]).toBe(JSON.stringify({ jobId: job.id }));
      expect(JSON.stringify(hash)).not.toContain("secret");
    } finally {
      raw.disconnect();
    }
  });

  it("mettre deux fois le même identifiant en file ne le traite qu'une fois (idempotence BullMQ)", async () => {
    const job = await enqueueJob({ rotate: 90 });
    expect(isOk(await queue.enqueue(job.id))).toBe(true);
    await waitUntil(() => statusOf(job.id) === "completed");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(processor.transformCalls).toHaveLength(1);
  });
});

describe("file BullMQ : échecs et nouvelles tentatives", () => {
  it("échec MÉTIER : failed après UNE seule tentative (inutile de réessayer), message client en base", async () => {
    const job = await enqueueJob({ rotate: 45.5 });
    await waitUntil(() => statusOf(job.id) === "failed");
    await new Promise((resolve) => setTimeout(resolve, 300)); // laisse le temps à une éventuelle nouvelle tentative (backoff 20 ms)
    expect(jobs.jobs.get(job.id)?.props).toMatchObject({ errorKind: "InvalidTransformation", attempts: 1 });
  });

  it("panne PASSAGÈRE : le job est retenté avec backoff puis réussit (2 tentatives)", async () => {
    images.failNextSaves = 1;
    const job = await enqueueJob({ rotate: 90 });
    await waitUntil(() => statusOf(job.id) === "completed");
    expect(jobs.jobs.get(job.id)?.props.attempts).toBe(2);
  });

  it("panne PERSISTANTE : après toutes les tentatives, failed ProcessingFailed (message générique)", async () => {
    images.failOnSave = true;
    const job = await enqueueJob({ rotate: 90 });
    await waitUntil(() => statusOf(job.id) === "failed");
    expect(jobs.jobs.get(job.id)?.props).toMatchObject({ errorKind: "ProcessingFailed", attempts: ATTEMPTS });
    expect(jobs.jobs.get(job.id)?.props.errorMessage).not.toMatch(/panne simulée/);
  });

  it("job absent de la base : abandonné sans nouvelle tentative et sans planter le worker", async () => {
    const result = await queue.enqueue(crypto.randomUUID());
    expect(isOk(result)).toBe(true);
    const next = await enqueueJob({ rotate: 90 }); // le worker continue de traiter les jobs suivants
    await waitUntil(() => statusOf(next.id) === "completed");
  });
});

describe("file BullMQ : arrêt et indisponibilité", () => {
  it("arrêt propre : worker.close() attend la fin du job en cours avant de rendre la main", async () => {
    let release: () => void = () => undefined;
    processor.transformGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const job = await enqueueJob({ rotate: 90 });
    await waitUntil(() => statusOf(job.id) === "processing");

    let closed = false;
    const closing = worker?.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(closed).toBe(false); // le job est encore en cours : close() attend
    release();
    await closing;
    expect(statusOf(job.id)).toBe("completed");
    worker = null;
  });

  it("Redis injoignable : enqueue renvoie QueueUnavailable (sans lever d'erreur et sans attendre)", async () => {
    const deadConnection = createQueueConnection("redis://127.0.0.1:1/0");
    const deadQueue = new BullMqTransformJobQueue(deadConnection, { attempts: 3, backoffMs: 20 });
    try {
      const started = Date.now();
      const result = await deadQueue.enqueue(crypto.randomUUID());
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.kind).toBe("QueueUnavailable");
      expect(Date.now() - started).toBeLessThan(4000);
    } finally {
      await deadQueue.close().catch(() => undefined);
      deadConnection.disconnect();
    }
  });
});
