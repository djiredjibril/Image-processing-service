/** Tests d'intégration de RedisTransformCache contre un vrai Redis (base de test) : TTL, verrou, attente, panne. */
import type { Redis } from "ioredis";
import { Redis as RawRedis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isOk } from "../../src/domain/shared/result.js";
import { ImageFormat } from "../../src/domain/value-objects/image-format.js";
import { TransformCacheKey } from "../../src/domain/value-objects/transform-cache-key.js";
import { TransformationSet } from "../../src/domain/value-objects/transformation-set.js";
import { createRedisClient } from "../../src/infrastructure/cache/redis-client.js";
import { LOCK_TTL_MS, RedisTransformCache } from "../../src/infrastructure/cache/redis-transform-cache.js";
import { createTestRedis, flushTestRedis, testRedisUrl } from "../helpers/test-redis.js";

const TTL_SECONDS = 120;
let redis: Redis;
let raw: RawRedis; // client SANS préfixe : observe les clés réelles
let cache: RedisTransformCache;

function keyFor(seed: string): TransformCacheKey {
  const set = TransformationSet.create({ rotate: 90 }, { maxSide: 8000 });
  if (!isOk(set)) throw new Error("jeu de test invalide");
  return TransformCacheKey.create({ ownerId: "u", sourceId: seed, transformations: set.value, outputFormat: ImageFormat.PNG });
}

beforeAll(async () => {
  redis = await createTestRedis();
  raw = new RawRedis(testRedisUrl());
  cache = new RedisTransformCache(redis, TTL_SECONDS);
});
beforeEach(async () => {
  await flushTestRedis(redis);
});
afterAll(async () => {
  await flushTestRedis(redis);
  redis.disconnect();
  raw.disconnect();
});

describe("RedisTransformCache : entrées", () => {
  it("set puis get restitue l'identifiant ; une clé absente donne null", async () => {
    const key = keyFor("a");
    expect(await cache.get(key)).toBeNull();
    await cache.set(key, "derive-1");
    expect(await cache.get(key)).toBe("derive-1");
    expect(await cache.get(keyFor("autre"))).toBeNull();
  });

  it("stocke sous ips:cache:transform:<hash> avec une durée de vie (TTL) égale à celle configurée", async () => {
    const key = keyFor("a");
    await cache.set(key, "derive-1");
    expect(await raw.get(`ips:cache:transform:${key.value}`)).toBe("derive-1");
    const ttl = await raw.ttl(`ips:cache:transform:${key.value}`);
    expect(ttl).toBeGreaterThan(TTL_SECONDS - 5);
    expect(ttl).toBeLessThanOrEqual(TTL_SECONDS);
  });

  it("l'entrée expire d'elle-même (TTL court)", async () => {
    const short = new RedisTransformCache(redis, 1);
    const key = keyFor("expire");
    await short.set(key, "derive-1");
    expect(await short.get(key)).toBe("derive-1");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(await short.get(key)).toBeNull();
  });
});

describe("RedisTransformCache : verrou", () => {
  it("est exclusif : un deuxième acquireLock sur la même clé renvoie null, une autre clé reste libre", async () => {
    const key = keyFor("a");
    const lock = await cache.acquireLock(key);
    expect(lock).not.toBeNull();
    expect(await cache.acquireLock(key)).toBeNull();
    expect(await cache.acquireLock(keyFor("b"))).not.toBeNull();
  });

  it("se libère avec release() : on peut alors le reprendre", async () => {
    const key = keyFor("a");
    const lock = await cache.acquireLock(key);
    await lock?.release();
    expect(await raw.exists(`ips:lock:transform:${key.value}`)).toBe(0);
    expect(await cache.acquireLock(key)).not.toBeNull();
  });

  it("expire tout seul (filet de sécurité si le détenteur plante)", async () => {
    const key = keyFor("a");
    await cache.acquireLock(key);
    const ttl = await raw.pttl(`ips:lock:transform:${key.value}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(LOCK_TTL_MS);
  });

  it("SÛRETÉ DU JETON : un ancien détenteur dont le verrou a expiré ne supprime PAS le verrou du nouveau détenteur", async () => {
    const key = keyFor("a");
    const lockKey = `ips:lock:transform:${key.value}`;
    const slowHolder = await cache.acquireLock(key);
    await raw.del(lockKey); // simule l'expiration du verrou du premier détenteur...
    const newHolder = await cache.acquireLock(key); // ...repris par un autre
    expect(newHolder).not.toBeNull();

    await slowHolder?.release(); // le premier, en retard, tente de libérer
    expect(await raw.exists(lockKey)).toBe(1); // le verrou du nouveau détenteur est INTACT
    expect(await cache.acquireLock(key)).toBeNull();

    await newHolder?.release();
    expect(await raw.exists(lockKey)).toBe(0);
  });
});

describe("RedisTransformCache : attente", () => {
  it("waitFor renvoie le résultat dès qu'il apparaît pendant l'attente", async () => {
    const key = keyFor("a");
    await cache.acquireLock(key);
    setTimeout(() => void cache.set(key, "derive-1"), 250);
    const start = Date.now();
    expect(await cache.waitFor(key, 3000)).toBe("derive-1");
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("waitFor renvoie tout de suite la valeur si elle existe déjà", async () => {
    const key = keyFor("a");
    await cache.set(key, "derive-1");
    expect(await cache.waitFor(key, 3000)).toBe("derive-1");
  });

  it("waitFor s'arrête dès que le verrou disparaît sans résultat (le détenteur a échoué) : pas d'attente inutile", async () => {
    const key = keyFor("a");
    const lock = await cache.acquireLock(key);
    setTimeout(() => void lock?.release(), 250);
    const start = Date.now();
    expect(await cache.waitFor(key, 5000)).toBeNull();
    expect(Date.now() - start).toBeLessThan(1500);
  });

  it("waitFor renvoie null au bout du délai si le verrou reste posé sans résultat", async () => {
    const key = keyFor("a");
    await cache.acquireLock(key);
    const start = Date.now();
    expect(await cache.waitFor(key, 400)).toBeNull();
    expect(Date.now() - start).toBeGreaterThanOrEqual(380);
  });
});

describe("RedisTransformCache : Redis indisponible (fail-open)", () => {
  it("get → null, set → sans erreur, acquireLock → verrou sans effet, waitFor → null, le tout rapidement", async () => {
    const dead = createRedisClient("redis://127.0.0.1:1/0");
    const broken = new RedisTransformCache(dead, TTL_SECONDS);
    try {
      const start = Date.now();
      const key = keyFor("a");
      expect(await broken.get(key)).toBeNull();
      await expect(broken.set(key, "derive-1")).resolves.toBeUndefined();
      const lock = await broken.acquireLock(key);
      expect(lock).not.toBeNull();
      await expect(lock?.release()).resolves.toBeUndefined();
      expect(await broken.waitFor(key, 2000)).toBeNull();
      expect(Date.now() - start).toBeLessThan(1500);
    } finally {
      dead.disconnect();
    }
  });
});
