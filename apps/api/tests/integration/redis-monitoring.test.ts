/** Tests d'intégration des compteurs et de l'observateur Redis contre un vrai Redis (base de test) : lecture, familles de clés, panne. */
import type { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRedisClient } from "../../src/infrastructure/cache/redis-client.js";
import { RedisMonitor } from "../../src/infrastructure/cache/redis-monitor.js";
import { RedisStatsCounters } from "../../src/infrastructure/cache/redis-stats-counters.js";
import { createTestRedis, flushTestRedis } from "../helpers/test-redis.js";

let redis: Redis;

beforeAll(async () => {
  redis = await createTestRedis();
});
beforeEach(async () => {
  await flushTestRedis(redis);
});
afterAll(async () => {
  await flushTestRedis(redis);
  redis.disconnect();
});

describe("RedisStatsCounters", () => {
  it("repart de zéro, compte chaque compteur séparément et de façon atomique (50 incréments simultanés)", async () => {
    const counters = new RedisStatsCounters(redis);
    expect(await counters.readAll()).toEqual({ cache_hit: 0, cache_miss: 0, rate_limited: 0 });
    await Promise.all(Array.from({ length: 50 }, () => counters.increment("cache_hit")));
    await counters.increment("cache_miss");
    expect(await counters.readAll()).toEqual({ cache_hit: 50, cache_miss: 1, rate_limited: 0 });
  });

  it("fail-open : Redis injoignable → aucune erreur, lecture à zéro", async () => {
    const dead = createRedisClient("redis://127.0.0.1:1/0");
    try {
      const counters = new RedisStatsCounters(dead);
      await expect(counters.increment("cache_hit")).resolves.toBeUndefined();
      expect(await counters.readAll()).toEqual({ cache_hit: 0, cache_miss: 0, rate_limited: 0 });
    } finally {
      dead.disconnect();
    }
  });
});

describe("RedisMonitor", () => {
  it("lit la version, la mémoire, les clients et la durée de fonctionnement de Redis", async () => {
    const stats = await new RedisMonitor(redis).stats();
    expect(stats.available).toBe(true);
    expect(stats.version).toMatch(/^\d+\.\d+/);
    expect(stats.usedMemoryBytes).toBeGreaterThan(0);
    expect(stats.connectedClients).toBeGreaterThanOrEqual(1);
    expect(stats.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it("compte les clés de l'application PAR FAMILLE (et ignore celles qui ne lui appartiennent pas)", async () => {
    await redis.set("cache:transform:a", "1");
    await redis.set("cache:transform:b", "1");
    await redis.set("lock:transform:a", "t", "PX", 30_000);
    await redis.set("ratelimit:read:u1", "3");
    await redis.set("ratelimit:auth:ip", "1");
    await redis.set("ratelimit:upload:u1", "1");
    await redis.set("bull:transform-image:id", "9");
    await redis.set("stats:cache_hit", "5"); // famille connue de l'application mais non comptée
    const stats = await new RedisMonitor(redis).stats();
    expect(stats.keys).toEqual({ cacheEntries: 2, activeLocks: 1, rateLimitCounters: 3, queueKeys: 1 });
    expect(stats.approximate).toBe(false);
  });

  it("plafonne le parcours des clés et le signale (approximate), sans bloquer Redis", async () => {
    for (let i = 0; i < 300; i++) await redis.set(`cache:transform:k${String(i)}`, "1");
    const capped = await new RedisMonitor(redis, { maxIterations: 1, count: 10 }).stats();
    expect(capped.approximate).toBe(true);
    expect(capped.keys?.cacheEntries ?? 0).toBeLessThan(300);
    const full = await new RedisMonitor(redis).stats();
    expect(full.keys?.cacheEntries).toBe(300);
    expect(full.approximate).toBe(false);
  });

  it("fail-open : Redis injoignable → available: false, sans erreur", async () => {
    const dead = createRedisClient("redis://127.0.0.1:1/0");
    try {
      expect(await new RedisMonitor(dead).stats()).toMatchObject({ available: false, version: null, keys: null });
    } finally {
      dead.disconnect();
    }
  });
});
