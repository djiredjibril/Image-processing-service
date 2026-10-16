/** Tests E2E de POST /login : HTTP → use case → PostgreSQL → argon2 → JWT. */
import type { Express } from "express";
import type pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JwtTokenService } from "../../src/infrastructure/security/jwt-token-service.js";
import { buildTestApp, TEST_JWT_SECRET } from "../helpers/build-test-app.js";
import { createMigratedTestPool, resetTables } from "../helpers/test-db.js";

let pool: pg.Pool;
let app: Express;

beforeAll(async () => {
  pool = await createMigratedTestPool();
  app = buildTestApp(pool);
});
beforeEach(async () => {
  await resetTables(pool);
});
afterAll(async () => {
  await pool.end();
});

describe("POST /login", () => {
  it("200 { token } : le jeton identifie l'utilisateur inscrit", async () => {
    const registered = await request(app).post("/register").send({ email: "a@b.co", password: "motdepasse" });
    const res = await request(app).post("/login").send({ email: "A@B.co", password: "motdepasse" });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body as object)).toEqual(["token"]);
    const identity = await new JwtTokenService(TEST_JWT_SECRET, "1h").verify((res.body as { token: string }).token);
    expect(identity).toEqual({ userId: (registered.body as { id: string }).id });
  });

  it("401 identique pour mauvais mot de passe et e-mail inconnu", async () => {
    await request(app).post("/register").send({ email: "a@b.co", password: "motdepasse" });
    const wrongPassword = await request(app).post("/login").send({ email: "a@b.co", password: "mauvaismdp" });
    const unknownEmail = await request(app).post("/login").send({ email: "zzz@b.co", password: "motdepasse" });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it("400 pour un corps invalide", async () => {
    expect((await request(app).post("/login").send({})).status).toBe(400);
    expect((await request(app).post("/login").send({ email: 1, password: 2 })).status).toBe(400);
  });
});
