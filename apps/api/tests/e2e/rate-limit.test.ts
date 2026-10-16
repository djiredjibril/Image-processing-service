/** Tests E2E du rate limiting avec un VRAI Redis : paliers, 429, en-têtes, indépendance des utilisateurs, panne. */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Express } from "express";
import type { Redis } from "ioredis";
import type pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRedisClient } from "../../src/infrastructure/cache/redis-client.js";
import { RedisRateLimiter } from "../../src/infrastructure/cache/redis-rate-limiter.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { makeQuadrants } from "../helpers/images.js";
import { createMigratedTestPool, resetTables } from "../helpers/test-db.js";
import { createTestRedis, flushTestRedis } from "../helpers/test-redis.js";

const WINDOW = 60;
const LIMITS = {
  auth: { limit: 3, windowSeconds: WINDOW },
  upload: { limit: 2, windowSeconds: WINDOW },
  transform: { limit: 2, windowSeconds: WINDOW },
  read: { limit: 3, windowSeconds: WINDOW },
};

let pool: pg.Pool;
let redis: Redis;
let storageDir: string;
let free: Express; // app SANS limite pratique : sert à créer les comptes et les images
let limited: Express; // app avec les limites basses ci-dessus
let aliceToken: string;
let bobToken: string;
let aliceImageId: string;

async function tokenFor(email: string): Promise<string> {
  await request(free).post("/register").send({ email, password: "motdepasse" });
  const login = await request(free).post("/login").send({ email, password: "motdepasse" });
  return (login.body as { token: string }).token;
}

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
const png = async (): Promise<Buffer> => makeQuadrants(40, 20);
const countImages = async (): Promise<number> => (await pool.query("SELECT 1 FROM images")).rowCount ?? 0;

beforeAll(async () => {
  pool = await createMigratedTestPool();
  redis = await createTestRedis();
  storageDir = await mkdtemp(path.join(os.tmpdir(), "ratelimit-e2e-"));
  free = buildTestApp(pool, { storageDir });
  limited = buildTestApp(pool, { storageDir, rateLimiter: new RedisRateLimiter(redis), rateLimits: LIMITS });
});
beforeEach(async () => {
  await resetTables(pool);
  await flushTestRedis(redis);
  aliceToken = await tokenFor("alice@example.com");
  bobToken = await tokenFor("bob@example.com");
  const up = await request(free).post("/images").set(authed(aliceToken)).attach("image", await png(), "a.png");
  aliceImageId = (up.body as { id: string }).id;
});
afterAll(async () => {
  await flushTestRedis(redis);
  await pool.end();
  redis.disconnect();
  await rm(storageDir, { recursive: true, force: true });
});

describe("palier auth (par IP, partagé par /register et /login)", () => {
  it("accepte 3 requêtes puis répond 429 + Retry-After ; /register et /login partagent le compteur", async () => {
    const credentials = { email: "x@example.com", password: "motdepasse" };
    expect((await request(limited).post("/register").send(credentials)).status).toBe(201);
    expect((await request(limited).post("/login").send(credentials)).status).toBe(200);
    expect((await request(limited).post("/login").send({ ...credentials, password: "mauvais-mdp" })).status).toBe(401);

    const blocked = await request(limited).post("/login").send(credentials);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ error: "TooManyRequests" });
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(Number(blocked.headers["retry-after"])).toBeLessThanOrEqual(WINDOW);
    expect(blocked.headers["ratelimit-limit"]).toBe("3");
    expect(blocked.headers["ratelimit-remaining"]).toBe("0");

    expect((await request(limited).post("/register").send({ email: "y@example.com", password: "motdepasse" })).status).toBe(429);
  });

  it("une requête refusée (429) n'exécute pas le use case : aucun compte créé", async () => {
    for (let i = 0; i < 3; i++) await request(limited).post("/login").send({ email: "n@example.com", password: "motdepasse" });
    const before = (await pool.query("SELECT 1 FROM users")).rowCount;
    const res = await request(limited).post("/register").send({ email: "late@example.com", password: "motdepasse" });
    expect(res.status).toBe(429);
    expect((await pool.query("SELECT 1 FROM users")).rowCount).toBe(before);
  });
});

describe("paliers par utilisateur", () => {
  it("upload : 2 acceptés puis 429, et le fichier refusé n'est pas stocké", async () => {
    const before = await countImages();
    for (let i = 0; i < 2; i++) {
      expect((await request(limited).post("/images").set(authed(aliceToken)).attach("image", await png(), "p.png")).status).toBe(201);
    }
    const blocked = await request(limited).post("/images").set(authed(aliceToken)).attach("image", await png(), "p.png");
    expect(blocked.status).toBe(429);
    expect(await countImages()).toBe(before + 2);
  });

  it("transform : 2 acceptés puis 429, indépendamment des autres paliers", async () => {
    const send = (): request.Test => request(limited).post(`/images/${aliceImageId}/transform`).set(authed(aliceToken)).send({ rotate: 90 });
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(200); // HIT du cache : compte quand même dans la limite
    const blocked = await send();
    expect(blocked.status).toBe(429);
    expect((await request(limited).get("/images").set(authed(aliceToken))).status).toBe(200); // lecture non affectée
  });

  it("lecture : GET /images et GET /images/:id partagent le même compteur", async () => {
    expect((await request(limited).get("/images").set(authed(aliceToken))).status).toBe(200);
    expect((await request(limited).get(`/images/${aliceImageId}`).set(authed(aliceToken))).status).toBe(200);
    const third = await request(limited).get("/images").set(authed(aliceToken));
    expect(third.status).toBe(200);
    expect(third.headers["ratelimit-remaining"]).toBe("0");
    expect((await request(limited).get(`/images/${aliceImageId}`).set(authed(aliceToken))).status).toBe(429);
  });

  it("les utilisateurs sont indépendants : Alice bloquée, Bob passe", async () => {
    for (let i = 0; i < 4; i++) await request(limited).get("/images").set(authed(aliceToken));
    expect((await request(limited).get("/images").set(authed(aliceToken))).status).toBe(429);
    expect((await request(limited).get("/images").set(authed(bobToken))).status).toBe(200);
  });

  it("les requêtes non authentifiées (401) ne consomment le quota de personne", async () => {
    for (let i = 0; i < 10; i++) expect((await request(limited).get("/images")).status).toBe(401);
    const ok = await request(limited).get("/images").set(authed(aliceToken));
    expect(ok.status).toBe(200);
    expect(ok.headers["ratelimit-remaining"]).toBe("2");
  });

  it("un 429 prime sur le reste : même une image d'un autre utilisateur donne 429 une fois bloqué (jamais d'indice)", async () => {
    for (let i = 0; i < 3; i++) await request(limited).get("/images").set(authed(bobToken));
    const res = await request(limited).get(`/images/${aliceImageId}`).set(authed(bobToken));
    expect(res.status).toBe(429);
  });
});

describe("en-têtes et réinitialisation", () => {
  it("les réponses acceptées portent RateLimit-Limit / Remaining / Reset", async () => {
    const res = await request(limited).get("/images").set(authed(aliceToken));
    expect(res.headers["ratelimit-limit"]).toBe("3");
    expect(res.headers["ratelimit-remaining"]).toBe("2");
    expect(Number(res.headers["ratelimit-reset"])).toBeGreaterThanOrEqual(1);
  });

  it("CORS expose Retry-After et RateLimit-* au JavaScript du navigateur", async () => {
    const res = await request(limited).get("/images").set(authed(aliceToken)).set("Origin", "http://localhost:4200");
    const exposed = String(res.headers["access-control-expose-headers"]).toLowerCase();
    for (const name of ["retry-after", "ratelimit-limit", "ratelimit-remaining", "ratelimit-reset", "x-cache"]) {
      expect(exposed).toContain(name);
    }
  });

  it("la fenêtre se réinitialise : après expiration, le client peut de nouveau appeler", async () => {
    const shortLived = buildTestApp(pool, {
      storageDir,
      rateLimiter: new RedisRateLimiter(redis),
      rateLimits: { ...LIMITS, read: { limit: 1, windowSeconds: 1 } },
    });
    expect((await request(shortLived).get("/images").set(authed(aliceToken))).status).toBe(200);
    expect((await request(shortLived).get("/images").set(authed(aliceToken))).status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect((await request(shortLived).get("/images").set(authed(aliceToken))).status).toBe(200);
  });
});

describe("fail-open", () => {
  it("Redis mort : l'API répond normalement, sans limitation ni en-têtes RateLimit-*", async () => {
    const dead = createRedisClient("redis://127.0.0.1:1/0");
    try {
      const degraded = buildTestApp(pool, { storageDir, rateLimiter: new RedisRateLimiter(dead), rateLimits: LIMITS });
      for (let i = 0; i < 6; i++) {
        const res = await request(degraded).get("/images").set(authed(aliceToken));
        expect(res.status).toBe(200);
        expect(res.headers["ratelimit-limit"]).toBeUndefined();
      }
      expect((await readdir(storageDir)).length).toBeGreaterThan(0); // le stockage n'a pas été touché par la panne
    } finally {
      dead.disconnect();
    }
  });
});
