/**
 * Tests E2E de la supervision (`GET /monitoring/overview`) avec un VRAI Redis, une VRAIE file BullMQ et un vrai worker :
 * état de Redis, compteurs de la file, workers connectés, compteurs d'activité, confidentialité et indisponibilité.
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
import { RedisMonitor } from "../../src/infrastructure/cache/redis-monitor.js";
import { RedisRateLimiter } from "../../src/infrastructure/cache/redis-rate-limiter.js";
import { RedisStatsCounters } from "../../src/infrastructure/cache/redis-stats-counters.js";
import { SharpImageProcessor } from "../../src/infrastructure/image/sharp-image-processor.js";
import { PgImageRepository } from "../../src/infrastructure/persistence/pg-image-repository.js";
import { PgTransformJobRepository } from "../../src/infrastructure/persistence/pg-transform-job-repository.js";
import { createQueueConnection, createWorkerConnection } from "../../src/infrastructure/queue/bull-connection.js";
import { BullMqQueueMonitor } from "../../src/infrastructure/queue/bullmq-queue-monitor.js";
import { BullMqTransformJobQueue } from "../../src/infrastructure/queue/bullmq-transform-job-queue.js";
import { startTransformWorker } from "../../src/infrastructure/queue/transform-worker.js";
import { LocalFileStorage } from "../../src/infrastructure/storage/local-file-storage.js";
import { InMemoryTransformCache } from "../fakes/in-memory-transform-cache.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { makeQuadrants } from "../helpers/images.js";
import { createMigratedTestPool, resetTables } from "../helpers/test-db.js";
import { createTestRedis, flushTestRedis, testRedisUrl } from "../helpers/test-redis.js";

interface Overview {
  generatedAt: string;
  redis: { available: boolean; version: string | null; usedMemoryBytes: number | null; keys: { cacheEntries: number; rateLimitCounters: number; queueKeys: number } | null };
  queue: { available: boolean; counts: { waiting: number; active: number; completed: number; failed: number }; workers: number };
  counters: { cache_hit: number; cache_miss: number; rate_limited: number };
  recentJobs: { id: string; status: string; image: { id: string } | null }[];
}

let pool: pg.Pool;
let redis: Redis;
let storageDir: string;
let producer: Redis;
let workerConnection: Redis;
let queue: BullMqTransformJobQueue;
let queueMonitor: BullMqQueueMonitor;
let worker: Worker | null = null;
let app: Express;
let aliceToken: string;
let bobToken: string;
let aliceImageId: string;

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
const overview = async (token = aliceToken, target: Express = app): Promise<Overview> => (await request(target).get("/monitoring/overview").set(authed(token))).body as Overview;

async function tokenFor(email: string): Promise<string> {
  await request(app).post("/register").send({ email, password: "motdepasse" });
  return ((await request(app).post("/login").send({ email, password: "motdepasse" })).body as { token: string }).token;
}
async function until(condition: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs) throw new Error("condition non atteinte");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

beforeAll(async () => {
  pool = await createMigratedTestPool();
  redis = await createTestRedis();
  storageDir = await mkdtemp(path.join(os.tmpdir(), "monitoring-e2e-"));
});
beforeEach(async () => {
  await resetTables(pool);
  await flushTestRedis(redis);
  producer = createQueueConnection(testRedisUrl());
  workerConnection = createWorkerConnection(testRedisUrl());
  queue = new BullMqTransformJobQueue(producer, { attempts: 2, backoffMs: 20 });
  queueMonitor = new BullMqQueueMonitor(producer);
  app = buildTestApp(pool, { storageDir, jobQueue: queue, queueMonitor, redisMonitor: new RedisMonitor(redis), stats: new RedisStatsCounters(redis) });
  aliceToken = await tokenFor("alice@example.com");
  bobToken = await tokenFor("bob@example.com");
  const up = await request(app).post("/images").set(authed(aliceToken)).attach("image", await makeQuadrants(40, 20), "a.png");
  aliceImageId = (up.body as { id: string }).id;
});
afterEach(async () => {
  await worker?.close();
  worker = null;
  await queueMonitor.close();
  await queue.close();
  producer.disconnect();
  workerConnection.disconnect();
});
afterAll(async () => {
  await flushTestRedis(redis);
  await pool.end();
  redis.disconnect();
  await rm(storageDir, { recursive: true, force: true });
});

function startWorker(): void {
  const transform = new TransformImage(new PgImageRepository(pool), new LocalFileStorage(storageDir), new SharpImageProcessor({ limitInputPixels: 8000 ** 2 }), new InMemoryTransformCache(), { maxPixelsSide: 8000 });
  worker = startTransformWorker(workerConnection, new ProcessTransformJob(new PgTransformJobRepository(pool), transform), { concurrency: 2 });
}

describe("GET /monitoring/overview", () => {
  it("401 sans jeton", async () => {
    expect((await request(app).get("/monitoring/overview")).status).toBe(401);
  });

  it("200 : état de Redis, de la file, compteurs et jobs, sans cache navigateur", async () => {
    const res = await request(app).get("/monitoring/overview").set(authed(aliceToken));
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.body as Overview;
    expect(Date.now() - new Date(body.generatedAt).getTime()).toBeLessThan(5000);
    expect(body.redis).toMatchObject({ available: true });
    expect(body.redis.version).toMatch(/^\d+\./);
    expect(body.redis.usedMemoryBytes).toBeGreaterThan(0);
    expect(body.queue).toMatchObject({ available: true, workers: 0, counts: { waiting: 0, active: 0, completed: 0, failed: 0 } });
    expect(body.counters).toEqual({ cache_hit: 0, cache_miss: 0, rate_limited: 0 });
    expect(body.recentJobs).toEqual([]);
  });

  it("sans worker, les jobs s'accumulent (waiting) ; chacun ne voit QUE ses jobs mais la charge de la file est globale", async () => {
    for (const rotate of [10, 20]) await request(app).post(`/images/${aliceImageId}/jobs`).set(authed(aliceToken)).send({ rotate });
    const alice = await overview(aliceToken);
    expect(alice.queue.counts.waiting).toBe(2);
    expect(alice.recentJobs.map((job) => job.status)).toEqual(["queued", "queued"]);
    expect(alice.redis.keys?.queueKeys).toBeGreaterThan(0);

    const bob = await overview(bobToken);
    expect(bob.queue.counts.waiting).toBe(2); // la charge du système est visible de tous
    expect(bob.recentJobs).toEqual([]); // mais pas les jobs d'autrui
    expect(JSON.stringify(bob)).not.toContain(alice.recentJobs[0]?.id ?? "introuvable");
  });

  it("avec un worker : 1 worker connecté, et le job passe à « completed » avec son image, dans la file comme dans la liste", async () => {
    startWorker();
    await worker?.waitUntilReady();
    await request(app).post(`/images/${aliceImageId}/jobs`).set(authed(aliceToken)).send({ rotate: 90, format: "webp" });
    await until(async () => (await overview()).recentJobs[0]?.status === "completed");
    const done = await overview();
    expect(done.queue.workers).toBe(1);
    expect(done.queue.counts).toMatchObject({ waiting: 0, completed: 1, failed: 0 });
    expect(done.recentJobs[0]?.image).not.toBeNull();
    expect(done.counters.cache_miss).toBe(0); // le worker de ce test n'a pas de compteurs : seuls ceux de l'API comptent ici
  });

  it("compteurs d'activité : un calcul réel (cache_miss) puis la même demande servie par le cache (cache_hit)", async () => {
    const post = (): request.Test => request(app).post(`/images/${aliceImageId}/transform`).set(authed(aliceToken)).send({ rotate: 90 });
    expect((await post()).status).toBe(201);
    expect((await overview()).counters).toMatchObject({ cache_miss: 1, cache_hit: 0 });
    expect((await post()).status).toBe(200);
    expect((await overview()).counters).toMatchObject({ cache_miss: 1, cache_hit: 1 });
  });

  it("compteur rate_limited : chaque requête refusée (429) est comptée", async () => {
    const limited = buildTestApp(pool, {
      storageDir,
      rateLimiter: new RedisRateLimiter(redis),
      rateLimits: { auth: { limit: 1000, windowSeconds: 60 }, loginEmail: { limit: 1000, windowSeconds: 60 }, upload: { limit: 1000, windowSeconds: 60 }, transform: { limit: 1, windowSeconds: 60 }, read: { limit: 1000, windowSeconds: 60 } },
      stats: new RedisStatsCounters(redis),
    });
    const post = (rotate: number): request.Test => request(limited).post(`/images/${aliceImageId}/transform`).set(authed(aliceToken)).send({ rotate });
    expect((await post(10)).status).toBe(201);
    expect((await post(20)).status).toBe(429);
    expect((await post(30)).status).toBe(429);
    expect((await overview(aliceToken, limited)).counters.rate_limited).toBe(2);
  });

  it("Redis et la file injoignables : 200 quand même, avec available: false (la page doit pouvoir afficher la panne)", async () => {
    const deadRedis = createRedisClient("redis://127.0.0.1:1/0");
    const deadQueueConnection = createQueueConnection("redis://127.0.0.1:1/0");
    const deadQueueMonitor = new BullMqQueueMonitor(deadQueueConnection);
    try {
      const degraded = buildTestApp(pool, { storageDir, redisMonitor: new RedisMonitor(deadRedis), queueMonitor: deadQueueMonitor, stats: new RedisStatsCounters(deadRedis) });
      const res = await request(degraded).get("/monitoring/overview").set(authed(aliceToken));
      expect(res.status).toBe(200);
      const body = res.body as Overview;
      expect(body.redis.available).toBe(false);
      expect(body.queue.available).toBe(false);
      expect(body.counters).toEqual({ cache_hit: 0, cache_miss: 0, rate_limited: 0 });
    } finally {
      await deadQueueMonitor.close().catch(() => undefined);
      deadQueueConnection.disconnect();
      deadRedis.disconnect();
    }
  });

  it("l'endpoint compte dans le quota « lecture » (interrogé en continu, il doit rester limité)", async () => {
    const limited = buildTestApp(pool, {
      storageDir,
      rateLimiter: new RedisRateLimiter(redis),
      rateLimits: { auth: { limit: 1000, windowSeconds: 60 }, loginEmail: { limit: 1000, windowSeconds: 60 }, upload: { limit: 1000, windowSeconds: 60 }, transform: { limit: 1000, windowSeconds: 60 }, read: { limit: 2, windowSeconds: 60 } },
    });
    expect((await request(limited).get("/monitoring/overview").set(authed(aliceToken))).status).toBe(200);
    expect((await request(limited).get("/monitoring/overview").set(authed(aliceToken))).status).toBe(200);
    expect((await request(limited).get("/monitoring/overview").set(authed(aliceToken))).status).toBe(429);
  });
});
