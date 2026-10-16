/** Tests d'intégration du client Redis : connexion réelle, préfixe de clés, échec rapide en cas de panne. */
import { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createRedisClient, isRedisUp, REDIS_KEY_PREFIX, waitForRedis } from "../../src/infrastructure/cache/redis-client.js";
import { createTestRedis, flushTestRedis, isNonDefaultDatabase, testRedisUrl } from "../helpers/test-redis.js";

let redis: Redis;
const raw = new Redis(testRedisUrl()); // client SANS préfixe, pour observer les clés réelles

beforeAll(async () => {
  redis = await createTestRedis();
  await flushTestRedis(redis);
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await flushTestRedis(redis);
  redis.disconnect();
  raw.disconnect();
});

describe("createRedisClient (Redis disponible)", () => {
  it("waitForRedis renvoie true dès que la connexion est établie", async () => {
    const fresh = createRedisClient(testRedisUrl());
    try {
      expect(await waitForRedis(fresh, 3000)).toBe(true);
      expect(await isRedisUp(fresh)).toBe(true);
    } finally {
      fresh.disconnect();
    }
  });

  it("répond au ping et lit ce qu'il écrit", async () => {
    expect(await isRedisUp(redis)).toBe(true);
    await redis.set("exemple", "valeur", "EX", 60);
    expect(await redis.get("exemple")).toBe("valeur");
  });

  it("préfixe automatiquement toutes les clés par « ips: »", async () => {
    await redis.set("cle", "1", "EX", 60);
    expect(REDIS_KEY_PREFIX).toBe("ips:");
    expect(await raw.get("ips:cle")).toBe("1");
    expect(await raw.get("cle")).toBeNull();
  });

  it("travaille bien dans la base de test (pas la base 0 de développement)", () => {
    expect(isNonDefaultDatabase(testRedisUrl())).toBe(true);
    expect(isNonDefaultDatabase("redis://localhost:6380/0")).toBe(false);
    expect(isNonDefaultDatabase("redis://localhost:6380")).toBe(false);
    expect(isNonDefaultDatabase("redis://localhost:6380/1")).toBe(true);
  });
});

describe("createRedisClient (Redis indisponible)", () => {
  it("échoue VITE au lieu de bloquer : une commande est rejetée en moins d'une demi-seconde", async () => {
    const dead = createRedisClient("redis://127.0.0.1:1/0");
    try {
      const start = Date.now();
      await expect(dead.get("x")).rejects.toThrow();
      expect(Date.now() - start).toBeLessThan(500);
      expect(await isRedisUp(dead)).toBe(false);
    } finally {
      dead.disconnect();
    }
  });

  it("ne fait pas planter le process (erreur de connexion écoutée) et ne logge la panne qu'une seule fois", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const dead = createRedisClient("redis://127.0.0.1:1/0");
    try {
      await new Promise((resolve) => setTimeout(resolve, 900)); // plusieurs tentatives de reconnexion
      expect(errors).toHaveBeenCalledTimes(1);
      expect(String(errors.mock.calls[0]?.[0])).toContain("Redis indisponible");
    } finally {
      dead.disconnect();
    }
  });

  it("waitForRedis renvoie false (sans bloquer au-delà du délai) quand Redis est absent", async () => {
    const dead = createRedisClient("redis://127.0.0.1:1/0");
    try {
      const start = Date.now();
      expect(await waitForRedis(dead, 300)).toBe(false);
      expect(Date.now() - start).toBeLessThan(700);
    } finally {
      dead.disconnect();
    }
  });

  it("un client « paresseux » n'ouvre aucune connexion tant qu'on ne l'utilise pas", () => {
    const lazy = createRedisClient("redis://127.0.0.1:1/0", { lazyConnect: true });
    expect(lazy.status).toBe("wait");
    lazy.disconnect();
  });
});
