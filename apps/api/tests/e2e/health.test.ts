/** Test E2E : GET /health via supertest, sur l'app complète, la base de test et Redis. */
import { Redis } from "ioredis";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRedisClient } from "../../src/infrastructure/cache/redis-client.js";
import { createPool } from "../../src/infrastructure/persistence/database.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { testDatabaseUrl } from "../helpers/test-db.js";
import { createTestRedis } from "../helpers/test-redis.js";

const pool = createPool(testDatabaseUrl());
let redis: Redis;
const toClose: Redis[] = [];

beforeAll(async () => {
  redis = await createTestRedis();
  toClose.push(redis);
});

afterAll(async () => {
  await pool.end();
  for (const client of toClose) client.disconnect();
});

describe("GET /health", () => {
  it("200 « ok » quand la base ET Redis répondent", async () => {
    const res = await request(buildTestApp(pool, { redis })).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", database: "up", redis: "up" });
  });

  it("200 « degraded » quand Redis est tombé : le service continue de fonctionner sans cache", async () => {
    const deadRedis = createRedisClient("redis://127.0.0.1:1/0");
    toClose.push(deadRedis);
    const res = await request(buildTestApp(pool, { redis: deadRedis })).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "degraded", database: "up", redis: "down" });
  });

  it("503 quand la base est injoignable, même si Redis répond", async () => {
    const deadPool = new pg.Pool({ connectionString: "postgres://x:x@127.0.0.1:1/none" });
    const res = await request(buildTestApp(deadPool, { redis })).get("/health");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "error", database: "down", redis: "up" });
    await deadPool.end();
  });
});
