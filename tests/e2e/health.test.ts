/** Test E2E : GET /health via supertest, sur l'app complète et la base de test. */
import "dotenv/config";
import pg from "pg";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/infrastructure/http/app.js";
import { createPool } from "../../src/infrastructure/persistence/database.js";

const databaseUrl = process.env["TEST_DATABASE_URL"];
if (databaseUrl === undefined) {
  throw new Error("TEST_DATABASE_URL manquante (copier .env.example vers .env)");
}
const pool = createPool(databaseUrl);

afterAll(async () => {
  await pool.end();
});

describe("GET /health", () => {
  it("renvoie 200 quand la base répond", async () => {
    const res = await request(createApp({ pool })).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", database: "up" });
  });

  it("renvoie 503 quand la base est injoignable", async () => {
    const deadPool = new pg.Pool({ connectionString: "postgres://x:x@127.0.0.1:1/none" });
    const res = await request(createApp({ pool: deadPool })).get("/health");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "error", database: "down" });
    await deadPool.end();
  });
});
