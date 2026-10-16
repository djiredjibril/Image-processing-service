/** Tests E2E de POST /register : HTTP → use case → PostgreSQL → argon2. */
import type { Express } from "express";
import type pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";
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

describe("POST /register", () => {
  it("201 { id, email } sans jamais renvoyer le hash, et stocke un hash argon2", async () => {
    const res = await request(app).post("/register").send({ email: "Salut@Example.com", password: "motdepasse" });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body as object).sort()).toEqual(["email", "id"]);
    expect(res.body).toMatchObject({ email: "salut@example.com" });
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|hash|motdepasse/);

    const row = await pool.query<{ password_hash: string }>("SELECT password_hash FROM users");
    expect(row.rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
  });

  it("400 pour un e-mail invalide", async () => {
    const res = await request(app).post("/register").send({ email: "nope", password: "motdepasse" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "InvalidEmail" });
  });

  it("400 pour un mot de passe de moins de 8 caractères", async () => {
    const res = await request(app).post("/register").send({ email: "a@b.co", password: "court" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "WeakPassword" });
  });

  it("400 pour un corps vide, de mauvais types ou un JSON malformé", async () => {
    expect((await request(app).post("/register").send({})).status).toBe(400);
    expect((await request(app).post("/register").send({ email: 1, password: true })).status).toBe(400);
    const malformed = await request(app).post("/register").set("Content-Type", "application/json").send("{pas du json");
    expect(malformed.status).toBe(400);
    expect(malformed.body).toMatchObject({ error: "MalformedJson" });
  });

  it("409 si l'e-mail est déjà pris, même avec une autre casse", async () => {
    await request(app).post("/register").send({ email: "a@b.co", password: "motdepasse" });
    const res = await request(app).post("/register").send({ email: "A@B.CO", password: "motdepasse" });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "EmailAlreadyUsed" });
  });
});
