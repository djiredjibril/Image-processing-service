/** Tests d'intégration de RedisRateLimiter contre un vrai Redis : contrat, expiration réelle, atomicité, panne. */
import type { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRedisClient } from "../../src/infrastructure/cache/redis-client.js";
import { RedisRateLimiter } from "../../src/infrastructure/cache/redis-rate-limiter.js";
import { describeRateLimiterContract } from "../helpers/rate-limiter-contract.js";
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

describeRateLimiterContract("RedisRateLimiter", async () => {
  await flushTestRedis(redis);
  return { limiter: new RedisRateLimiter(redis), advance: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };
});

describe("RedisRateLimiter : spécificités Redis", () => {
  it("pose une expiration sur la clé (sinon un compteur resterait pour toujours)", async () => {
    await new RedisRateLimiter(redis).consume("ttl", { limit: 5, windowSeconds: 30 });
    const ttl = await redis.pttl("ratelimit:ttl");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30_000);
  });

  it("répare une clé qui a perdu son expiration", async () => {
    const limiter = new RedisRateLimiter(redis);
    await limiter.consume("heal", { limit: 5, windowSeconds: 30 });
    await redis.persist("ratelimit:heal"); // simule une clé sans TTL
    await limiter.consume("heal", { limit: 5, windowSeconds: 30 });
    expect(await redis.pttl("ratelimit:heal")).toBeGreaterThan(0);
  });

  it("fail-open : Redis injoignable → null, sans lever d'erreur", async () => {
    const dead = createRedisClient("redis://127.0.0.1:1/1");
    try {
      expect(await new RedisRateLimiter(dead).consume("k", { limit: 1, windowSeconds: 1 })).toBeNull();
    } finally {
      dead.disconnect();
    }
  });
});
