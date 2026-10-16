/**
 * Tests E2E des transformations asynchrones : HTTP (202 + polling) → PostgreSQL → file BullMQ (vrai Redis) →
 * worker (vrai sharp) → image dérivée lisible. Couvre aussi l'indisponibilité de la file et le rate limiting.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Worker } from "bullmq";
import type { Express } from "express";
import type { Redis } from "ioredis";
import type pg from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProcessTransformJob } from "../../src/application/use-cases/process-transform-job.js";
import { TransformImage } from "../../src/application/use-cases/transform-image.js";
import { createRedisClient } from "../../src/infrastructure/cache/redis-client.js";
import { RedisRateLimiter } from "../../src/infrastructure/cache/redis-rate-limiter.js";
import { SharpImageProcessor } from "../../src/infrastructure/image/sharp-image-processor.js";
import { PgImageRepository } from "../../src/infrastructure/persistence/pg-image-repository.js";
import { PgTransformJobRepository } from "../../src/infrastructure/persistence/pg-transform-job-repository.js";
import { createQueueConnection, createWorkerConnection } from "../../src/infrastructure/queue/bull-connection.js";
import { BullMqTransformJobQueue } from "../../src/infrastructure/queue/bullmq-transform-job-queue.js";
import { startTransformWorker } from "../../src/infrastructure/queue/transform-worker.js";
import { LocalFileStorage } from "../../src/infrastructure/storage/local-file-storage.js";
import { FakeTransformJobQueue } from "../fakes/fake-transform-job-queue.js";
import { InMemoryTransformCache } from "../fakes/in-memory-transform-cache.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { makeQuadrants } from "../helpers/images.js";
import { createMigratedTestPool, resetTables } from "../helpers/test-db.js";
import { createTestRedis, flushTestRedis, testRedisUrl } from "../helpers/test-redis.js";

interface JobBody {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  sourceImageId: string;
  attempts: number;
  image: { id: string; originalId: string; format: string; width: number; height: number } | null;
  error: { kind: string; message: string } | null;
}

let pool: pg.Pool;
let redis: Redis;
let storageDir: string;
let aliceToken: string;
let bobToken: string;
let aliceImageId: string;

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

async function tokenFor(app: Express, email: string): Promise<string> {
  await request(app).post("/register").send({ email, password: "motdepasse" });
  const login = await request(app).post("/login").send({ email, password: "motdepasse" });
  return (login.body as { token: string }).token;
}

async function waitForStatus(app: Express, token: string, jobId: string, wanted: JobBody["status"], timeoutMs = 10_000): Promise<JobBody> {
  const start = Date.now();
  for (;;) {
    const res = await request(app).get(`/jobs/${jobId}`).set(authed(token));
    const body = res.body as JobBody;
    if (body.status === wanted) return body;
    if (Date.now() - start > timeoutMs) throw new Error(`job resté « ${body.status} » (attendu « ${wanted} »)`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

beforeAll(async () => {
  pool = await createMigratedTestPool();
  redis = await createTestRedis();
  storageDir = await mkdtemp(path.join(os.tmpdir(), "jobs-e2e-"));
});
beforeEach(async () => {
  await resetTables(pool);
  await flushTestRedis(redis);
  const plain = buildTestApp(pool, { storageDir });
  aliceToken = await tokenFor(plain, "alice@example.com");
  bobToken = await tokenFor(plain, "bob@example.com");
  const up = await request(plain).post("/images").set(authed(aliceToken)).attach("image", await makeQuadrants(40, 20), "a.png");
  aliceImageId = (up.body as { id: string }).id;
});
afterAll(async () => {
  await flushTestRedis(redis);
  await pool.end();
  redis.disconnect();
  await rm(storageDir, { recursive: true, force: true });
});

describe("POST /images/:id/jobs et GET /jobs/:id (file factice, sans worker)", () => {
  it("202 + Location + job `queued` en base et en file ; le suivi renvoie son statut", async () => {
    const queue = new FakeTransformJobQueue();
    const app = buildTestApp(pool, { storageDir, jobQueue: queue });
    const res = await request(app).post(`/images/${aliceImageId}/jobs`).set(authed(aliceToken)).send({ rotate: 90, format: "webp" });

    expect(res.status).toBe(202);
    const body = res.body as JobBody;
    expect(body).toMatchObject({ status: "queued", sourceImageId: aliceImageId, attempts: 0, image: null, error: null });
    expect(res.headers["location"]).toBe(`/jobs/${body.id}`);
    expect(res.headers["retry-after"]).toBe("1");
    expect(queue.enqueued).toEqual([body.id]);
    expect((await pool.query("SELECT status FROM transform_jobs WHERE id = $1", [body.id])).rows[0]).toEqual({ status: "queued" });

    const polled = await request(app).get(`/jobs/${body.id}`).set(authed(aliceToken));
    expect(polled.status).toBe(200);
    expect(polled.body).toMatchObject({ id: body.id, status: "queued" });
  });

  it("400 : paramètres invalides, champ inconnu, corps vide, rien en base ni en file", async () => {
    const queue = new FakeTransformJobQueue();
    const app = buildTestApp(pool, { storageDir, jobQueue: queue });
    for (const payload of [{ rotate: 45.5 }, { inconnu: true }, {}, { resize: { width: 99_999 } }]) {
      const res = await request(app).post(`/images/${aliceImageId}/jobs`).set(authed(aliceToken)).send(payload);
      expect(res.status).toBe(400);
    }
    expect((await pool.query("SELECT 1 FROM transform_jobs")).rowCount).toBe(0);
    expect(queue.enqueued).toHaveLength(0);
  });

  it("404 : image d'un autre utilisateur, inconnue ou identifiant mal formé (mêmes réponses)", async () => {
    const app = buildTestApp(pool, { storageDir });
    const other = await request(app).post(`/images/${aliceImageId}/jobs`).set(authed(bobToken)).send({ rotate: 90 });
    const unknown = await request(app).post("/images/00000000-0000-4000-8000-000000000000/jobs").set(authed(aliceToken)).send({ rotate: 90 });
    const malformed = await request(app).post("/images/pas-un-uuid/jobs").set(authed(aliceToken)).send({ rotate: 90 });
    for (const res of [other, unknown, malformed]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "ImageNotFound", message: "Image introuvable" });
    }
  });

  it("401 sans jeton (création et suivi)", async () => {
    const app = buildTestApp(pool, { storageDir });
    expect((await request(app).post(`/images/${aliceImageId}/jobs`).send({ rotate: 90 })).status).toBe(401);
    expect((await request(app).get("/jobs/00000000-0000-4000-8000-000000000000")).status).toBe(401);
  });

  it("GET /jobs/:id : un job d'un autre utilisateur, inconnu ou mal formé donne le même 404", async () => {
    const app = buildTestApp(pool, { storageDir });
    const created = await request(app).post(`/images/${aliceImageId}/jobs`).set(authed(aliceToken)).send({ rotate: 90 });
    const jobId = (created.body as JobBody).id;
    const other = await request(app).get(`/jobs/${jobId}`).set(authed(bobToken));
    const unknown = await request(app).get("/jobs/00000000-0000-4000-8000-000000000000").set(authed(aliceToken));
    const malformed = await request(app).get("/jobs/nimporte").set(authed(aliceToken));
    for (const res of [other, unknown, malformed]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "JobNotFound", message: "Job introuvable" });
    }
  });

  it("file injoignable : 503, et aucun job `queued` orphelin n'est laissé en base", async () => {
    const queue = new FakeTransformJobQueue();
    queue.unavailable = true;
    const app = buildTestApp(pool, { storageDir, jobQueue: queue });
    const res = await request(app).post(`/images/${aliceImageId}/jobs`).set(authed(aliceToken)).send({ rotate: 90 });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: "QueueUnavailable" });
    expect((await pool.query("SELECT 1 FROM transform_jobs")).rowCount).toBe(0);
  });

  it("rate limiting : créer un job consomme le MÊME quota « transform » que la transformation synchrone ; le suivi, le quota « read »", async () => {
    const limits = { auth: { limit: 1000, windowSeconds: 60 }, loginEmail: { limit: 1000, windowSeconds: 60 }, upload: { limit: 1000, windowSeconds: 60 }, transform: { limit: 2, windowSeconds: 60 }, read: { limit: 3, windowSeconds: 60 } };
    const app = buildTestApp(pool, { storageDir, rateLimiter: new RedisRateLimiter(redis), rateLimits: limits });
    expect((await request(app).post(`/images/${aliceImageId}/jobs`).set(authed(aliceToken)).send({ rotate: 90 })).status).toBe(202);
    expect((await request(app).post(`/images/${aliceImageId}/transform`).set(authed(aliceToken)).send({ rotate: 180 })).status).toBe(201);
    const blocked = await request(app).post(`/images/${aliceImageId}/jobs`).set(authed(aliceToken)).send({ rotate: 270 });
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();

    const jobId = (await pool.query<{ id: string }>("SELECT id FROM transform_jobs")).rows[0]?.id ?? "";
    for (let i = 0; i < 3; i++) expect((await request(app).get(`/jobs/${jobId}`).set(authed(aliceToken))).status).toBe(200);
    expect((await request(app).get(`/jobs/${jobId}`).set(authed(aliceToken))).status).toBe(429);
  });
});

describe("parcours complet avec un vrai worker (BullMQ + Redis + sharp)", () => {
  let producerConnection: Redis;
  let workerConnection: Redis;
  let queue: BullMqTransformJobQueue;
  let worker: Worker | null = null;
  let app: Express;

  function startWorker(): void {
    const images = new PgImageRepository(pool);
    const transform = new TransformImage(
      images,
      new LocalFileStorage(storageDir),
      new SharpImageProcessor({ limitInputPixels: 8000 ** 2 }),
      new InMemoryTransformCache(),
      { maxPixelsSide: 8000 },
    );
    worker = startTransformWorker(workerConnection, new ProcessTransformJob(new PgTransformJobRepository(pool), transform), { concurrency: 2 });
  }

  beforeEach(() => {
    producerConnection = createQueueConnection(testRedisUrl());
    workerConnection = createWorkerConnection(testRedisUrl());
    queue = new BullMqTransformJobQueue(producerConnection, { attempts: 3, backoffMs: 20 });
    app = buildTestApp(pool, { storageDir, jobQueue: queue });
  });
  afterEach(async () => {
    await worker?.close();
    worker = null;
    await queue.close();
    producerConnection.disconnect();
    workerConnection.disconnect();
  });

  it("202 → polling → completed : l'image dérivée existe, descend de la source, et son fichier est lisible", async () => {
    startWorker();
    const created = await request(app).post(`/images/${aliceImageId}/jobs`).set(authed(aliceToken)).send({ rotate: 90, format: "webp" });
    expect(created.status).toBe(202);
    const jobId = (created.body as JobBody).id;

    const done = await waitForStatus(app, aliceToken, jobId, "completed");
    expect(done.attempts).toBe(1);
    expect(done.image).toMatchObject({ originalId: aliceImageId, format: "webp", width: 20, height: 40 }); // 40×20 pivoté de 90°
    expect(done.error).toBeNull();

    const file = await request(app).get(`/images/${done.image?.id ?? ""}`).set(authed(aliceToken));
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("image/webp");
    expect((await pool.query("SELECT 1 FROM images")).rowCount).toBe(2); // l'original + 1 dérivé
  });

  it("la file garde le travail tant qu'aucun worker n'est là : `queued`, puis traité au démarrage du worker", async () => {
    const created = await request(app).post(`/images/${aliceImageId}/jobs`).set(authed(aliceToken)).send({ filter: "sepia" });
    const jobId = (created.body as JobBody).id;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(((await request(app).get(`/jobs/${jobId}`).set(authed(aliceToken))).body as JobBody).status).toBe("queued");

    startWorker();
    const done = await waitForStatus(app, aliceToken, jobId, "completed");
    expect(done.image?.originalId).toBe(aliceImageId);
  });

  it("deux jobs identiques : un seul dérivé (cache partagé avec la transformation synchrone), les deux `completed`", async () => {
    startWorker();
    const first = await request(app).post(`/images/${aliceImageId}/jobs`).set(authed(aliceToken)).send({ rotate: 90 });
    const firstDone = await waitForStatus(app, aliceToken, (first.body as JobBody).id, "completed");
    const second = await request(app).post(`/images/${aliceImageId}/jobs`).set(authed(aliceToken)).send({ rotate: 90 });
    const secondDone = await waitForStatus(app, aliceToken, (second.body as JobBody).id, "completed");
    expect(secondDone.image?.id).toBe(firstDone.image?.id);
    expect((await pool.query("SELECT 1 FROM images")).rowCount).toBe(2);
  });

  it("échec détecté PAR LE WORKER (fichier source disparu après la demande) : `failed` avec une erreur claire, sans nouvelle tentative", async () => {
    const created = await request(app).post(`/images/${aliceImageId}/jobs`).set(authed(aliceToken)).send({ rotate: 90 });
    const jobId = (created.body as JobBody).id;
    const key = (await pool.query<{ storage_key: string }>("SELECT storage_key FROM images WHERE id = $1", [aliceImageId])).rows[0]?.storage_key ?? "";
    await rm(path.join(storageDir, key));

    startWorker();
    const failed = await waitForStatus(app, aliceToken, jobId, "failed");
    expect(failed.error).toMatchObject({ kind: "ImageNotFound" });
    expect(failed.image).toBeNull();
    expect(failed.attempts).toBe(1);
  });

  it("isolation : Bob ne peut pas suivre le job d'Alice, même terminé", async () => {
    startWorker();
    const created = await request(app).post(`/images/${aliceImageId}/jobs`).set(authed(aliceToken)).send({ rotate: 90 });
    const jobId = (created.body as JobBody).id;
    await waitForStatus(app, aliceToken, jobId, "completed");
    expect((await request(app).get(`/jobs/${jobId}`).set(authed(bobToken))).status).toBe(404);
  });
});

describe("Redis injoignable (vraie file BullMQ)", () => {
  it("POST renvoie 503 rapidement et ne laisse aucun job en base", async () => {
    const dead = createQueueConnection("redis://127.0.0.1:1/0");
    const queue = new BullMqTransformJobQueue(dead, { attempts: 3, backoffMs: 20 });
    const deadCache = createRedisClient("redis://127.0.0.1:1/0");
    try {
      const app = buildTestApp(pool, { storageDir, jobQueue: queue, redis: deadCache });
      const started = Date.now();
      const res = await request(app).post(`/images/${aliceImageId}/jobs`).set(authed(aliceToken)).send({ rotate: 90 });
      expect(res.status).toBe(503);
      expect(Date.now() - started).toBeLessThan(4000);
      expect((await pool.query("SELECT 1 FROM transform_jobs")).rowCount).toBe(0);
    } finally {
      await queue.close().catch(() => undefined);
      dead.disconnect();
      deadCache.disconnect();
    }
  });
});
