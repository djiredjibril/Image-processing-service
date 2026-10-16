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
import { S3FileUrlSigner } from "../../src/infrastructure/storage/s3-file-url-signer.js";
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

describe("URLs présignées (GET /images/:id/url) avec un vrai SeaweedFS", () => {
  let signedApp: Express;
  let imageId: string;
  let png: Buffer;

  async function signedUrl(forToken = token, id = imageId): Promise<string> {
    const res = await request(signedApp).get(`/images/${id}/url`).set(authed(forToken));
    return (res.body as { url: string }).url;
  }

  beforeEach(async () => {
    signedApp = buildTestApp(pool, { storage: s3, urlSigner: new S3FileUrlSigner(client, bucket), presignedUrlTtlSeconds: 60 });
    png = await makeQuadrants(40, 20);
    const up = await request(signedApp).post("/images").set(authed(token)).attach("image", png, "p.png");
    imageId = (up.body as { id: string }).id;
  });

  it("200 + URL signée : le fichier se télécharge DIRECTEMENT depuis le stockage, sans jeton, avec les mêmes octets et le bon type", async () => {
    const res = await request(signedApp).get(`/images/${imageId}/url`).set(authed(token));
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.body as { url: string; expiresInSeconds: number; expiresAt: string };
    expect(body.expiresInSeconds).toBe(60);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(new URL(body.url).searchParams.get("X-Amz-Expires")).toBe("60");

    const direct = await fetch(body.url); // aucun en-tête Authorization : la signature de l'URL suffit
    expect(direct.status).toBe(200);
    expect(direct.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await direct.arrayBuffer()).equals(png)).toBe(true);
  });

  it("l'URL est refusée (403) si la signature est altérée, ou si on la détourne vers un autre objet du bucket", async () => {
    const other = await request(signedApp).post("/images").set(authed(token)).attach("image", await makeQuadrants(20, 20), "q.png");
    const otherId = (other.body as { id: string }).id;
    const url = new URL(await signedUrl());
    const otherKey = (await pool.query<{ storage_key: string }>("SELECT storage_key FROM images WHERE id = $1", [otherId])).rows[0]?.storage_key ?? "";

    const tampered = new URL(url);
    const signature = tampered.searchParams.get("X-Amz-Signature") ?? "";
    tampered.searchParams.set("X-Amz-Signature", (signature.startsWith("0") ? "1" : "0") + signature.slice(1));
    expect((await fetch(tampered)).status).toBe(403);

    const redirected = new URL(url);
    redirected.pathname = `/${bucket}/${otherKey}`;
    expect((await fetch(redirected)).status).toBe(403);

    const stretched = new URL(url);
    stretched.searchParams.set("X-Amz-Expires", "604800"); // prolonger la durée invalide la signature
    expect((await fetch(stretched)).status).toBe(403);
  });

  it("l'URL EXPIRE : valable avant l'échéance, refusée (403) après", async () => {
    const shortLived = buildTestApp(pool, { storage: s3, urlSigner: new S3FileUrlSigner(client, bucket), presignedUrlTtlSeconds: 2 });
    const url = (await request(shortLived).get(`/images/${imageId}/url`).set(authed(token))).body as { url: string };
    expect((await fetch(url.url)).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 3200));
    expect((await fetch(url.url)).status).toBe(403);
  });

  it("autorisation : un autre utilisateur, un id inconnu ou mal formé, ou l'absence de jeton ne délivrent aucune URL", async () => {
    const other = await request(signedApp).get(`/images/${imageId}/url`).set(authed(otherToken));
    const unknown = await request(signedApp).get("/images/00000000-0000-4000-8000-000000000000/url").set(authed(token));
    const malformed = await request(signedApp).get("/images/nimporte/url").set(authed(token));
    for (const res of [other, unknown, malformed]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "ImageNotFound", message: "Image introuvable" });
    }
    expect((await request(signedApp).get(`/images/${imageId}/url`)).status).toBe(401);
  });

  it("l'URL d'un dérivé fonctionne aussi", async () => {
    const created = await request(signedApp).post(`/images/${imageId}/transform`).set(authed(token)).send({ rotate: 90, format: "webp" });
    const derivedId = (created.body as { id: string }).id;
    const res = await fetch(await signedUrl(token, derivedId));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
  });

  it("stockage sans URLs signées (disque local) : 501 PresignedUrlsUnsupported, et l'autorisation passe d'abord (404 pour autrui)", async () => {
    const localApp = buildTestApp(pool, {});
    const own = await request(localApp).get(`/images/${imageId}/url`).set(authed(token));
    expect(own.status).toBe(501);
    expect(own.body).toMatchObject({ error: "PresignedUrlsUnsupported" });
    expect((await request(localApp).get(`/images/${imageId}/url`).set(authed(otherToken))).status).toBe(404);
  });
});
