/** Tests E2E du cache des transformations avec un VRAI Redis : HIT/MISS, doublons, requêtes simultanées, panne. */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Express } from "express";
import type { Redis } from "ioredis";
import type pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RedisTransformCache } from "../../src/infrastructure/cache/redis-transform-cache.js";
import { createRedisClient } from "../../src/infrastructure/cache/redis-client.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { makeQuadrants } from "../helpers/images.js";
import { createMigratedTestPool, resetTables } from "../helpers/test-db.js";
import { createTestRedis, flushTestRedis } from "../helpers/test-redis.js";

interface Summary {
  id: string;
  originalId: string | null;
  format: string;
  width: number;
  height: number;
}

let pool: pg.Pool;
let redis: Redis;
let app: Express;
let storageDir: string;
let aliceToken: string;
let bobToken: string;

async function tokenFor(application: Express, email: string): Promise<string> {
  await request(application).post("/register").send({ email, password: "motdepasse" });
  const login = await request(application).post("/login").send({ email, password: "motdepasse" });
  return (login.body as { token: string }).token;
}

async function uploadAs(application: Express, token: string, size: readonly [number, number] = [40, 20]): Promise<Summary> {
  const res = await request(application).post("/images").set("Authorization", `Bearer ${token}`).attach("image", await makeQuadrants(size[0], size[1]), "p.png");
  return res.body as Summary;
}

function transform(application: Express, token: string, id: string, body: object): request.Test {
  return request(application).post(`/images/${id}/transform`).set("Authorization", `Bearer ${token}`).send(body);
}

const countImages = async (): Promise<number> => (await pool.query("SELECT 1 FROM images")).rowCount ?? 0;
const countDerivedFiles = async (): Promise<number> => (await readdir(path.join(storageDir, "derived")).catch(() => [])).length;

beforeAll(async () => {
  pool = await createMigratedTestPool();
  redis = await createTestRedis();
  storageDir = await mkdtemp(path.join(os.tmpdir(), "cache-e2e-"));
  app = buildTestApp(pool, { storageDir, redis, cache: new RedisTransformCache(redis, 300) });
});
beforeEach(async () => {
  await resetTables(pool);
  await flushTestRedis(redis);
  await rm(path.join(storageDir, "derived"), { recursive: true, force: true });
  aliceToken = await tokenFor(app, "alice@example.com");
  bobToken = await tokenFor(app, "bob@example.com");
});
afterAll(async () => {
  await flushTestRedis(redis);
  await pool.end();
  redis.disconnect();
  await rm(storageDir, { recursive: true, force: true });
});

describe("cache des transformations (Redis réel)", () => {
  it("1re demande : 201 + X-Cache: MISS ; 2e demande identique : 200 + X-Cache: HIT, MÊME dérivé", async () => {
    const source = await uploadAs(app, aliceToken);
    const body = { rotate: 90, resize: { width: 20 }, filter: "sepia", format: "webp" };

    const first = await transform(app, aliceToken, source.id, body);
    const second = await transform(app, aliceToken, source.id, body);

    expect(first.status).toBe(201);
    expect(first.headers["x-cache"]).toBe("MISS");
    expect(second.status).toBe(200);
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(second.body).toEqual(first.body);
  });

  it("aucun doublon : après 1 MISS et 4 HIT, il n'y a que l'original + UN dérivé en base et UN fichier sur disque", async () => {
    const source = await uploadAs(app, aliceToken);
    for (let i = 0; i < 5; i += 1) await transform(app, aliceToken, source.id, { rotate: 90 });
    expect(await countImages()).toBe(2);
    expect(await countDerivedFiles()).toBe(1);
  });

  it("des paramètres équivalents donnent un HIT (valeurs par défaut explicites, rotation -90° ≡ 270°, ordre des champs)", async () => {
    const source = await uploadAs(app, aliceToken);
    const first = await transform(app, aliceToken, source.id, { rotate: 270, resize: { width: 10 }, watermark: { text: " Hello " } });
    const second = await transform(app, aliceToken, source.id, {
      watermark: { opacity: 0.5, position: "bottom-right", text: "Hello" },
      resize: { fit: "inside", width: 10 },
      flip: false,
      rotate: -90,
    });
    expect(first.headers["x-cache"]).toBe("MISS");
    expect(second.headers["x-cache"]).toBe("HIT");
    expect((second.body as Summary).id).toBe((first.body as Summary).id);
  });

  it("des paramètres différents → nouveau MISS et nouveau dérivé ; l'image source différente aussi", async () => {
    const a = await uploadAs(app, aliceToken);
    const b = await uploadAs(app, aliceToken);
    const r1 = await transform(app, aliceToken, a.id, { rotate: 90 });
    const r2 = await transform(app, aliceToken, a.id, { rotate: 180 });
    const r3 = await transform(app, aliceToken, b.id, { rotate: 90 });
    expect([r1.headers["x-cache"], r2.headers["x-cache"], r3.headers["x-cache"]]).toEqual(["MISS", "MISS", "MISS"]);
    expect(new Set([(r1.body as Summary).id, (r2.body as Summary).id, (r3.body as Summary).id]).size).toBe(3);
  });

  it("SIMULTANÉES : 8 demandes identiques en parallèle → un seul traitement et un seul dérivé en base et sur disque", async () => {
    // Grande image + rotation à 45° : le traitement dure assez longtemps pour que les 8 requêtes se chevauchent
    // réellement (avec une miniature, la 1re finirait avant l'arrivée des autres et le test ne prouverait rien).
    const source = await uploadAs(app, aliceToken, [2500, 2500]);
    const slow = { rotate: 45, filter: "grayscale", resize: { width: 800 } };
    const responses = await Promise.all(Array.from({ length: 8 }, () => transform(app, aliceToken, source.id, slow)));

    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
    expect(responses.filter((r) => r.headers["x-cache"] === "MISS")).toHaveLength(1);
    expect(new Set(responses.map((r) => (r.body as Summary).id)).size).toBe(1);
    expect(await countImages()).toBe(2);
    expect(await countDerivedFiles()).toBe(1);
    expect(await redis.keys("lock:transform:*")).toHaveLength(0); // aucun verrou résiduel
  });

  it("un cache ne sert jamais un autre utilisateur : Bob obtient 404 sur l'image d'Alice, même avec des paramètres déjà en cache", async () => {
    const source = await uploadAs(app, aliceToken);
    await transform(app, aliceToken, source.id, { rotate: 90 });
    const asBob = await transform(app, bobToken, source.id, { rotate: 90 });
    expect(asBob.status).toBe(404);
    expect(asBob.headers["x-cache"]).toBeUndefined();
  });

  it("une demande invalide n'est jamais mise en cache et reste en 400", async () => {
    const source = await uploadAs(app, aliceToken);
    for (let i = 0; i < 2; i += 1) expect((await transform(app, aliceToken, source.id, { rotate: 999 })).status).toBe(400);
    expect(await redis.keys("cache:transform:*")).toHaveLength(0);
  });

  it("entrée périmée : si le dérivé a disparu de la base, la demande suivante recalcule (201) au lieu de servir un fantôme", async () => {
    const source = await uploadAs(app, aliceToken);
    const first = await transform(app, aliceToken, source.id, { rotate: 90 });
    await pool.query("DELETE FROM images WHERE id = $1", [(first.body as Summary).id]);

    const again = await transform(app, aliceToken, source.id, { rotate: 90 });
    expect(again.status).toBe(201);
    expect(again.headers["x-cache"]).toBe("MISS");
    expect((again.body as Summary).id).not.toBe((first.body as Summary).id);
    expect((await transform(app, aliceToken, source.id, { rotate: 90 })).headers["x-cache"]).toBe("HIT");
  });

  it("l'entrée du cache expire (TTL) : après expiration, la même demande recalcule", async () => {
    const shortApp = buildTestApp(pool, { storageDir, redis, cache: new RedisTransformCache(redis, 1) });
    const source = await uploadAs(shortApp, aliceToken);
    await transform(shortApp, aliceToken, source.id, { rotate: 90 });
    expect((await transform(shortApp, aliceToken, source.id, { rotate: 90 })).headers["x-cache"]).toBe("HIT");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect((await transform(shortApp, aliceToken, source.id, { rotate: 90 })).headers["x-cache"]).toBe("MISS");
  });

  it("le dérivé en cache reste le même fichier : sa relecture donne les mêmes octets pour les deux réponses", async () => {
    const source = await uploadAs(app, aliceToken);
    const first = (await transform(app, aliceToken, source.id, { rotate: 90 })).body as Summary;
    const second = (await transform(app, aliceToken, source.id, { rotate: 90 })).body as Summary;
    const read = async (id: string): Promise<Buffer> =>
      (await request(app).get(`/images/${id}`).set("Authorization", `Bearer ${aliceToken}`).responseType("blob")).body as Buffer;
    expect((await read(first.id)).equals(await read(second.id))).toBe(true);
  });

  it("l'en-tête X-Cache est lisible par le navigateur (exposé par CORS)", async () => {
    const res = await request(app).options("/images/x/transform").set("Origin", "http://localhost:4200").set("Access-Control-Request-Method", "POST");
    const real = await request(app).get("/health").set("Origin", "http://localhost:4200");
    expect(res.status).toBeLessThan(300);
    expect(real.headers["access-control-expose-headers"]).toContain("X-Cache");
  });
});

describe("cache des transformations : Redis tombé (fail-open)", () => {
  it("la transformation fonctionne normalement (201 à chaque fois, sans dédoublonnage) et l'API ne plante pas", async () => {
    const dead = createRedisClient("redis://127.0.0.1:1/0");
    const degraded = buildTestApp(pool, { storageDir, redis: dead, cache: new RedisTransformCache(dead, 300) });
    try {
      const source = await uploadAs(degraded, aliceToken);
      const first = await transform(degraded, aliceToken, source.id, { rotate: 90 });
      const second = await transform(degraded, aliceToken, source.id, { rotate: 90 });
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(first.headers["x-cache"]).toBe("MISS");
      expect((second.body as Summary).id).not.toBe((first.body as Summary).id);
    } finally {
      dead.disconnect();
    }
  });
});
