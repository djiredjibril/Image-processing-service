/**
 * Tests E2E avec un VRAI stockage S3 (SeaweedFS) : upload, lecture, transformation synchrone et asynchrone (worker),
 * puis vérification que les objets sont bien dans le bucket sous les clés enregistrées en base.
 */
import { HeadObjectCommand, ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import type { Worker } from "bullmq";
import type { Express } from "express";
import type { Redis } from "ioredis";
import type pg from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProcessTransformJob } from "../../src/application/use-cases/process-transform-job.js";
import { TransformImage } from "../../src/application/use-cases/transform-image.js";
import { SharpImageProcessor } from "../../src/infrastructure/image/sharp-image-processor.js";
import { PgImageRepository } from "../../src/infrastructure/persistence/pg-image-repository.js";
import { PgTransformJobRepository } from "../../src/infrastructure/persistence/pg-transform-job-repository.js";
import { createQueueConnection, createWorkerConnection } from "../../src/infrastructure/queue/bull-connection.js";
import { BullMqTransformJobQueue } from "../../src/infrastructure/queue/bullmq-transform-job-queue.js";
import { startTransformWorker } from "../../src/infrastructure/queue/transform-worker.js";
import type { S3FileStorage } from "../../src/infrastructure/storage/s3-file-storage.js";
import { InMemoryTransformCache } from "../fakes/in-memory-transform-cache.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { makeQuadrants } from "../helpers/images.js";
import { createMigratedTestPool, resetTables } from "../helpers/test-db.js";
import { createTestRedis, flushTestRedis, testRedisUrl } from "../helpers/test-redis.js";
import { createTestS3Storage, emptyTestBucket } from "../helpers/test-s3.js";

let pool: pg.Pool;
let redis: Redis;
let s3: S3FileStorage;
let client: S3Client;
let bucket: string;
let app: Express;
let token: string;
let otherToken: string;

const authed = (value: string) => ({ Authorization: `Bearer ${value}` });

async function tokenFor(email: string): Promise<string> {
  await request(app).post("/register").send({ email, password: "motdepasse" });
  return ((await request(app).post("/login").send({ email, password: "motdepasse" })).body as { token: string }).token;
}

async function bucketKeys(): Promise<string[]> {
  const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
  return (listed.Contents ?? []).flatMap((object) => (object.Key === undefined ? [] : [object.Key]));
}

beforeAll(async () => {
  pool = await createMigratedTestPool();
  redis = await createTestRedis();
  ({ storage: s3, client, bucket } = await createTestS3Storage());
  app = buildTestApp(pool, { storage: s3 });
});
beforeEach(async () => {
  await resetTables(pool);
  await flushTestRedis(redis);
  await emptyTestBucket(client);
  token = await tokenFor("alice@example.com");
  otherToken = await tokenFor("bob@example.com");
});
afterAll(async () => {
  await emptyTestBucket(client);
  await flushTestRedis(redis);
  await pool.end();
  redis.disconnect();
});

describe("avec un stockage S3", () => {
  it("upload : l'objet est dans le bucket sous la clé enregistrée en base, avec le bon Content-Type ; GET renvoie les mêmes octets", async () => {
    const png = await makeQuadrants(40, 20);
    const up = await request(app).post("/images").set(authed(token)).attach("image", png, "p.png");
    expect(up.status).toBe(201);
    const id = (up.body as { id: string }).id;

    const key = (await pool.query<{ storage_key: string }>("SELECT storage_key FROM images WHERE id = $1", [id])).rows[0]?.storage_key ?? "";
    expect(key).toMatch(/^originals\/[0-9a-f-]{36}\.png$/);
    expect(await bucketKeys()).toEqual([key]);
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    expect(head.ContentType).toBe("image/png");
    expect(head.ContentLength).toBe(png.length);

    const got = await request(app).get(`/images/${id}`).set(authed(token)).buffer(true).parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        callback(null, Buffer.concat(chunks));
      });
    });
    expect(got.status).toBe(200);
    expect((got.body as Buffer).equals(png)).toBe(true);
  });

  it("un autre utilisateur reçoit 404 (le stockage ne change pas l'autorisation)", async () => {
    const up = await request(app).post("/images").set(authed(token)).attach("image", await makeQuadrants(40, 20), "p.png");
    const id = (up.body as { id: string }).id;
    expect((await request(app).get(`/images/${id}`).set(authed(otherToken))).status).toBe(404);
  });

  it("transformation synchrone : le dérivé est écrit sous derived/ et l'original reste intact dans le bucket", async () => {
    const up = await request(app).post("/images").set(authed(token)).attach("image", await makeQuadrants(40, 20), "p.png");
    const id = (up.body as { id: string }).id;
    const originalKeys = await bucketKeys();

    const res = await request(app).post(`/images/${id}/transform`).set(authed(token)).send({ rotate: 90, format: "webp" });
    expect(res.status).toBe(201);
    const keys = await bucketKeys();
    expect(keys).toHaveLength(2);
    expect(keys.filter((key) => key.startsWith("derived/") && key.endsWith(".webp"))).toHaveLength(1);
    expect(keys).toEqual(expect.arrayContaining(originalKeys));
  });

  it("fichier manquant dans le bucket pour une image connue en base : 404 (incohérence signalée, pas de crash)", async () => {
    const up = await request(app).post("/images").set(authed(token)).attach("image", await makeQuadrants(40, 20), "p.png");
    const id = (up.body as { id: string }).id;
    await emptyTestBucket(client);
    expect((await request(app).get(`/images/${id}`).set(authed(token))).status).toBe(404);
  });
});

describe("transformation asynchrone avec un worker et un stockage S3 partagé", () => {
  let producer: Redis;
  let workerConn: Redis;
  let queue: BullMqTransformJobQueue;
  let worker: Worker | null = null;

  beforeEach(() => {
    producer = createQueueConnection(testRedisUrl());
    workerConn = createWorkerConnection(testRedisUrl());
    queue = new BullMqTransformJobQueue(producer, { attempts: 3, backoffMs: 20 });
  });
  afterEach(async () => {
    await worker?.close();
    worker = null;
    await queue.close();
    producer.disconnect();
    workerConn.disconnect();
  });

  it("le worker lit la source et écrit le dérivé dans le MÊME bucket que l'API ; le résultat est lisible via l'API", async () => {
    const asyncApp = buildTestApp(pool, { storage: s3, jobQueue: queue });
    const transform = new TransformImage(new PgImageRepository(pool), s3, new SharpImageProcessor({ limitInputPixels: 8000 ** 2 }), new InMemoryTransformCache(), {
      maxPixelsSide: 8000,
    });
    worker = startTransformWorker(workerConn, new ProcessTransformJob(new PgTransformJobRepository(pool), transform), { concurrency: 1 });

    const up = await request(asyncApp).post("/images").set(authed(token)).attach("image", await makeQuadrants(40, 20), "p.png");
    const id = (up.body as { id: string }).id;
    const created = await request(asyncApp).post(`/images/${id}/jobs`).set(authed(token)).send({ rotate: 90, format: "webp" });
    expect(created.status).toBe(202);
    const jobId = (created.body as { id: string }).id;

    let derivedId: string | null = null;
    for (let i = 0; i < 200 && derivedId === null; i++) {
      const polled = (await request(asyncApp).get(`/jobs/${jobId}`).set(authed(token))).body as { status: string; image: { id: string } | null };
      if (polled.status === "failed") throw new Error("job échoué");
      derivedId = polled.image?.id ?? null;
      if (derivedId === null) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(derivedId).not.toBeNull();
    expect((await bucketKeys()).filter((key) => key.startsWith("derived/"))).toHaveLength(1);
    const file = await request(asyncApp).get(`/images/${derivedId ?? ""}`).set(authed(token));
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("image/webp");
  });
});
