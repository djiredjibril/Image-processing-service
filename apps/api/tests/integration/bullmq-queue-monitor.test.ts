/** Tests d'intégration de l'observateur de file BullMQ contre un VRAI Redis : compteurs par état, workers connectés, panne. */
import type { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProcessTransformJob } from "../../src/application/use-cases/process-transform-job.js";
import { TransformImage } from "../../src/application/use-cases/transform-image.js";
import { UploadImage } from "../../src/application/use-cases/upload-image.js";
import { TransformJob } from "../../src/domain/entities/transform-job.js";
import { isOk } from "../../src/domain/shared/result.js";
import { createQueueConnection, createWorkerConnection } from "../../src/infrastructure/queue/bull-connection.js";
import { BullMqQueueMonitor } from "../../src/infrastructure/queue/bullmq-queue-monitor.js";
import { BullMqTransformJobQueue } from "../../src/infrastructure/queue/bullmq-transform-job-queue.js";
import { startTransformWorker } from "../../src/infrastructure/queue/transform-worker.js";
import { FakeImageProcessor } from "../fakes/fake-image-processor.js";
import { InMemoryFileStorage } from "../fakes/in-memory-file-storage.js";
import { InMemoryImageRepository } from "../fakes/in-memory-image-repository.js";
import { InMemoryTransformCache } from "../fakes/in-memory-transform-cache.js";
import { InMemoryTransformJobRepository } from "../fakes/in-memory-transform-job-repository.js";
import { createTestRedis, flushTestRedis, testRedisUrl } from "../helpers/test-redis.js";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("contenu")]);

let redis: Redis;
let producerConnection: Redis;
let workerConnection: Redis;
let queue: BullMqTransformJobQueue;
let monitor: BullMqQueueMonitor;
let worker: Worker | null = null;
let jobs: InMemoryTransformJobRepository;
let storage: InMemoryFileStorage;
let images: InMemoryImageRepository;
let processor: FakeImageProcessor;
let sourceId: string;

async function until(condition: () => Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs) throw new Error("condition non atteinte");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function enqueue(): Promise<TransformJob> {
  const job = TransformJob.create({ ownerId: "owner", sourceImageId: sourceId, transformations: { rotate: 90 } });
  await jobs.save(job);
  await queue.enqueue(job.id);
  return job;
}

beforeAll(async () => {
  redis = await createTestRedis();
});
beforeEach(async () => {
  await flushTestRedis(redis);
  producerConnection = createQueueConnection(testRedisUrl());
  workerConnection = createWorkerConnection(testRedisUrl());
  queue = new BullMqTransformJobQueue(producerConnection, { attempts: 1, backoffMs: 10 });
  monitor = new BullMqQueueMonitor(producerConnection);
  storage = new InMemoryFileStorage();
  processor = new FakeImageProcessor();
  images = new InMemoryImageRepository();
  jobs = new InMemoryTransformJobRepository();
  const uploaded = await new UploadImage(storage, processor, images, { maxBytes: 1000, maxPixelsSide: 8000 }).execute({ ownerId: "owner", data: JPEG });
  if (!isOk(uploaded)) throw new Error("upload de test échoué");
  sourceId = uploaded.value.id;
});
afterEach(async () => {
  await worker?.close();
  worker = null;
  await monitor.close();
  await queue.close();
  producerConnection.disconnect();
  workerConnection.disconnect();
});
afterAll(async () => {
  await flushTestRedis(redis);
  redis.disconnect();
});

function startWorker(): Worker {
  const transform = new TransformImage(images, storage, processor, new InMemoryTransformCache(), { maxPixelsSide: 8000 });
  return startTransformWorker(workerConnection, new ProcessTransformJob(jobs, transform), { concurrency: 1 });
}

describe("BullMqQueueMonitor", () => {
  it("file vide : tout à zéro, 0 worker, mais disponible", async () => {
    expect(await monitor.snapshot()).toEqual({ available: true, counts: { waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 }, workers: 0 });
  });

  it("sans worker, les jobs s'accumulent en « waiting » (le travail est gardé)", async () => {
    await enqueue();
    await enqueue();
    await enqueue();
    const snapshot = await monitor.snapshot();
    expect(snapshot.counts.waiting).toBe(3);
    expect(snapshot.workers).toBe(0);
  });

  it("voit un worker connecté, puis les jobs passer en « active » puis « completed »", async () => {
    let release: () => void = () => undefined;
    processor.transformGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await enqueue();
    worker = startWorker();
    await worker.waitUntilReady();
    await until(async () => (await monitor.snapshot()).counts.active === 1);
    expect((await monitor.snapshot()).workers).toBe(1);

    release();
    await until(async () => (await monitor.snapshot()).counts.completed === 1);
    const done = await monitor.snapshot();
    expect(done.counts).toMatchObject({ waiting: 0, active: 0, completed: 1, failed: 0 });
    expect([...jobs.jobs.values()].map((job) => job.status)).toEqual(["completed"]); // réussi pour de vrai, pas un échec métier « terminé » pour BullMQ
  });

  it("compte les jobs échoués définitivement (panne technique, une seule tentative)", async () => {
    images.failOnSave = true;
    await enqueue();
    worker = startWorker();
    await until(async () => (await monitor.snapshot()).counts.failed === 1);
  });

  it("revient à 0 worker quand le worker s'arrête", async () => {
    worker = startWorker();
    await worker.waitUntilReady();
    await until(async () => (await monitor.snapshot()).workers === 1);
    await worker.close();
    worker = null;
    await until(async () => (await monitor.snapshot()).workers === 0);
  });

  it("Redis injoignable : available: false en moins de ~2 s, sans erreur", async () => {
    const dead = createQueueConnection("redis://127.0.0.1:1/0");
    const deadMonitor = new BullMqQueueMonitor(dead);
    try {
      const started = Date.now();
      const snapshot = await deadMonitor.snapshot();
      expect(snapshot.available).toBe(false);
      expect(snapshot.workers).toBe(0);
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      await deadMonitor.close().catch(() => undefined);
      dead.disconnect();
    }
  });
});
