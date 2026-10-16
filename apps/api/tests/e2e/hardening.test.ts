/**
 * Tests E2E du durcissement (phase 6) : en-têtes de sécurité, adresse IP derrière un proxy, limite de connexion par e-mail,
 * plafond de concurrence des transformations, hygiène des journaux. Rate limiting avec un VRAI Redis.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Express } from "express";
import type { Redis } from "ioredis";
import { Redis as RawRedis } from "ioredis";
import type pg from "pg";
import request from "supertest";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RedisRateLimiter } from "../../src/infrastructure/cache/redis-rate-limiter.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { FakeImageProcessor } from "../fakes/fake-image-processor.js";
import { createMigratedTestPool, resetTables } from "../helpers/test-db.js";
import { createTestRedis, flushTestRedis, testRedisUrl } from "../helpers/test-redis.js";

const WINDOW = 60;
const HIGH = { limit: 1000, windowSeconds: WINDOW };
const limits = (overrides: Record<string, { limit: number; windowSeconds: number }> = {}) => ({
  auth: HIGH,
  loginEmail: HIGH,
  upload: HIGH,
  transform: HIGH,
  read: HIGH,
  ...overrides,
});

let pool: pg.Pool;
let redis: Redis;
let raw: RawRedis; // client SANS préfixe : observe les clés réelles (`ips:...`)
let storageDir: string;
let free: Express;

beforeAll(async () => {
  pool = await createMigratedTestPool();
  redis = await createTestRedis();
  raw = new RawRedis(testRedisUrl());
  storageDir = await mkdtemp(path.join(os.tmpdir(), "hardening-e2e-"));
  free = buildTestApp(pool, { storageDir });
});
beforeEach(async () => {
  await resetTables(pool);
  await flushTestRedis(redis);
});
afterAll(async () => {
  await flushTestRedis(redis);
  await pool.end();
  redis.disconnect();
  raw.disconnect();
  await rm(storageDir, { recursive: true, force: true });
});

const credentials = (email: string) => ({ email, password: "motdepasse" });
const login = (app: Express, email: string, ip?: string, password = "mauvais-mdp"): request.Test => {
  const req = request(app).post("/login");
  if (ip !== undefined) void req.set("X-Forwarded-For", ip);
  return req.send({ email, password });
};

describe("en-têtes de sécurité", () => {
  it("les réponses portent nosniff, un CORP same-site, pas de X-Powered-By, et un cadrage interdit", async () => {
    const res = await request(free).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-site");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["strict-transport-security"]).toBeDefined();
  });

  it("les erreurs aussi (401, 404 de route inconnue) ; CORS continue de répondre à l'origine autorisée", async () => {
    const unauthorized = await request(free).get("/images");
    expect(unauthorized.headers["x-content-type-options"]).toBe("nosniff");
    const cors = await request(free).get("/health").set("Origin", "http://localhost:4200");
    expect(cors.headers["access-control-allow-origin"]).toBe("http://localhost:4200");
    const foreign = await request(free).get("/health").set("Origin", "http://evil.example");
    expect(foreign.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("une route inconnue répond en JSON (pas de page HTML qui révèle le framework)", async () => {
    const res = await request(free).get("/nimporte/quoi");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body).toEqual({ error: "NotFound", message: "Route introuvable" });
    expect(JSON.stringify(res.body)).not.toMatch(/express|cannot/i);
  });
});

describe("adresse IP derrière un proxy (TRUST_PROXY)", () => {
  const authLimits = limits({ auth: { limit: 3, windowSeconds: WINDOW } });

  it("sans proxy de confiance (0), X-Forwarded-For est IGNORÉ : changer d'IP annoncée ne contourne pas la limite", async () => {
    const app = buildTestApp(pool, { storageDir, rateLimiter: new RedisRateLimiter(redis), rateLimits: authLimits, trustProxyHops: 0 });
    for (let i = 1; i <= 3; i++) {
      expect((await login(app, `user${String(i)}@example.com`, `203.0.113.${String(i)}`)).status).toBe(401);
    }
    expect((await login(app, "user4@example.com", "203.0.113.4")).status).toBe(429);
    expect((await login(app, "user5@example.com", "198.51.100.77")).status).toBe(429);
  });

  it("avec 1 proxy de confiance, chaque IP annoncée par le proxy a son propre compteur ; la même IP partage le sien", async () => {
    const app = buildTestApp(pool, { storageDir, rateLimiter: new RedisRateLimiter(redis), rateLimits: authLimits, trustProxyHops: 1 });
    for (let i = 0; i < 3; i++) expect((await login(app, "a@example.com", "203.0.113.1")).status).toBe(401);
    expect((await login(app, "a@example.com", "203.0.113.1")).status).toBe(429); // même client : bloqué
    expect((await login(app, "a@example.com", "203.0.113.2")).status).toBe(401); // autre client derrière le proxy : passe
  });
});

describe("limite de connexion par adresse e-mail", () => {
  const emailLimits = limits({ loginEmail: { limit: 3, windowSeconds: WINDOW } });
  const build = (): Express => buildTestApp(pool, { storageDir, rateLimiter: new RedisRateLimiter(redis), rateLimits: emailLimits, trustProxyHops: 1 });

  it("un compte visé depuis des IP DIFFÉRENTES est bloqué au bout de 3 essais (brute-force distribué), un autre compte non", async () => {
    const app = build();
    for (let i = 1; i <= 3; i++) expect((await login(app, "victime@example.com", `203.0.113.${String(i)}`)).status).toBe(401);
    const blocked = await login(app, "victime@example.com", "203.0.113.99");
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect((await login(app, "autre@example.com", "203.0.113.99")).status).toBe(401);
  });

  it("la casse et les espaces ne contournent pas la limite", async () => {
    const app = build();
    await login(app, "victime@example.com", "203.0.113.1");
    await login(app, "VICTIME@Example.com", "203.0.113.2");
    await login(app, "  victime@example.com  ", "203.0.113.3");
    expect((await login(app, "victime@EXAMPLE.COM", "203.0.113.4")).status).toBe(429);
  });

  it("le bon mot de passe est lui aussi refusé une fois la limite atteinte (la limite compte toutes les tentatives)", async () => {
    const app = build();
    await request(free).post("/register").send(credentials("victime@example.com"));
    for (let i = 1; i <= 3; i++) await login(app, "victime@example.com", `203.0.113.${String(i)}`);
    expect((await login(app, "victime@example.com", "203.0.113.50", "motdepasse")).status).toBe(429);
  });

  it("aucune adresse e-mail n'est stockée en clair dans Redis", async () => {
    const app = build();
    await login(app, "victime@example.com", "203.0.113.1");
    const keys = await raw.keys("ips:ratelimit:loginEmail:*");
    expect(keys).toHaveLength(1);
    expect(keys.join(" ")).not.toMatch(/victime|example/);
  });

  it("un corps sans e-mail exploitable donne 400 et ne consomme aucun quota d'e-mail", async () => {
    const app = build();
    for (let i = 0; i < 5; i++) expect((await request(app).post("/login").send({ password: "x" })).status).toBe(400);
    await login(app, "temoin@example.com", "203.0.113.9"); // témoin : un e-mail valide, lui, est bien compté
    expect(await raw.keys("ips:ratelimit:loginEmail:*")).toHaveLength(1);
  });
});

describe("plafond de transformations simultanées", () => {
  it("au-delà du plafond : 503 + Retry-After immédiat ; 401 pour un anonyme ; les places sont rendues à la fin du traitement", async () => {
    // Faux processeur « à porte » : le 1er traitement reste en cours tant qu'on ne l'ouvre pas (pas de dépendance au temps de calcul).
    const processor = new FakeImageProcessor();
    const app = buildTestApp(pool, { storageDir, processor, maxConcurrentTransforms: 1 });
    await request(app).post("/register").send(credentials("alice@example.com"));
    const token = ((await request(app).post("/login").send(credentials("alice@example.com"))).body as { token: string }).token;
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("contenu")]);
    const up = await request(app).post("/images").set("Authorization", `Bearer ${token}`).attach("image", jpeg, "p.jpg");
    const id = (up.body as { id: string }).id;
    const post = (body: object, authed = true): request.Test => {
      const req = request(app).post(`/images/${id}/transform`);
      return authed ? req.set("Authorization", `Bearer ${token}`).send(body) : req.send(body);
    };

    let openGate: () => void = () => undefined;
    processor.transformGate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const started = processor.nextTransformStarted();
    const first = post({ rotate: 10 }).then((res) => res);
    await started; // le plafond (1) est maintenant saturé

    const busy = await post({ rotate: 20 });
    expect(busy.status).toBe(503);
    expect(busy.headers["retry-after"]).toBe("1");
    expect(busy.body).toMatchObject({ error: "ServerBusy" });
    expect((await post({ rotate: 30 }, false)).status).toBe(401); // l'authentification passe AVANT le plafond
    expect(processor.transformCalls).toHaveLength(1); // la requête refusée n'a lancé aucun traitement

    openGate();
    expect((await first).status).toBe(201);
    processor.transformGate = null;
    expect((await post({ rotate: 40 })).status).toBe(201); // la place a été rendue
  });

  it("une réponse DÉJÀ en cache est servie (200 HIT) même quand le plafond est saturé : seul le travail coûteux est refusé", async () => {
    const processor = new FakeImageProcessor();
    const app = buildTestApp(pool, { storageDir, processor, maxConcurrentTransforms: 1 });
    await request(app).post("/register").send(credentials("alice@example.com"));
    const token = ((await request(app).post("/login").send(credentials("alice@example.com"))).body as { token: string }).token;
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("contenu")]);
    const id = ((await request(app).post("/images").set("Authorization", `Bearer ${token}`).attach("image", jpeg, "p.jpg")).body as { id: string }).id;
    const post = (rotate: number): request.Test => request(app).post(`/images/${id}/transform`).set("Authorization", `Bearer ${token}`).send({ rotate });

    expect((await post(90)).status).toBe(201); // mis en cache
    let openGate: () => void = () => undefined;
    processor.transformGate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const started = processor.nextTransformStarted();
    const busy = post(180).then((res) => res);
    await started; // plafond saturé

    const hit = await post(90);
    expect(hit.status).toBe(200);
    expect(hit.headers["x-cache"]).toBe("HIT");
    expect((await post(270)).status).toBe(503); // un NOUVEAU calcul, lui, est refusé

    openGate();
    expect((await busy).status).toBe(201);
  });
});

describe("hygiène des journaux", () => {
  const spies: { mockRestore: () => void }[] = [];
  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
  });

  it("ni mot de passe, ni jeton, ni empreinte de mot de passe n'apparaissent dans les journaux, succès comme erreurs", async () => {
    const logged: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      spies.push(vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack ?? ""}` : String(arg))).join(" "));
      }));
    }
    const secretPassword = "Sup3r-Secret-Passw0rd!";
    await request(free).post("/register").send({ email: "alice@example.com", password: secretPassword });
    const loginRes = await request(free).post("/login").send({ email: "alice@example.com", password: secretPassword });
    const token = (loginRes.body as { token: string }).token;
    await request(free).post("/login").send({ email: "alice@example.com", password: "autre-mot-de-passe" });
    await request(free).post("/register").set("Content-Type", "application/json").send('{"email": "x@y.z", "password": ');
    await request(free).post("/register").send(credentials("alice@example.com")); // doublon
    await request(free).get("/images").set("Authorization", `Bearer ${token}`);
    await request(free).get("/images").set("Authorization", "Bearer jeton.falsifie.x");
    const hash = (await pool.query<{ password_hash: string }>("SELECT password_hash FROM users LIMIT 1")).rows[0]?.password_hash ?? "";

    const everything = logged.join("\n");
    expect(everything).not.toContain(secretPassword);
    expect(everything).not.toContain("autre-mot-de-passe");
    expect(everything).not.toContain(token);
    expect(everything).not.toContain(hash);
    expect(hash).toContain("$argon2id$"); // la vérification a un sens : l'empreinte existe bien
  });
});

describe("client qui coupe pendant un téléchargement", () => {
  it("n'est pas journalisé comme une erreur serveur, et le serveur reste sain", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    const server = free.listen(0);
    try {
      await request(free).post("/register").send(credentials("alice@example.com"));
      const token = ((await request(free).post("/login").send(credentials("alice@example.com"))).body as { token: string }).token;
      const big = await sharp({ create: { width: 1500, height: 1500, channels: 3, background: { r: 9, g: 9, b: 9 }, noise: { type: "gaussian", mean: 128, sigma: 60 } } }).png().toBuffer();
      const up = await request(free).post("/images").set("Authorization", `Bearer ${token}`).attach("image", big, "grosse.png");
      expect(up.status).toBe(201); // l'image de test doit être valide (≈ 6 Mo, sous la limite de 10 Mo)
      const id = (up.body as { id: string }).id;

      const { port } = server.address() as { port: number };
      for (let i = 0; i < 3; i++) {
        const res = await fetch(`http://127.0.0.1:${String(port)}/images/${id}`, { headers: { Authorization: `Bearer ${token}` } });
        const reader = res.body?.getReader();
        await reader?.read(); // un premier morceau reçu...
        await reader?.cancel(); // ...puis le client coupe
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(errors.filter((line) => line.includes("Erreur pendant l'envoi"))).toEqual([]);
      expect((await request(free).get("/health")).status).toBe(200);
    } finally {
      spy.mockRestore();
      server.close();
    }
  });
});
