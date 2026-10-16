/** Tests E2E de GET /images/:id : upload puis relecture, autorisation par propriétaire. */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Express } from "express";
import type pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";
import { makeImage } from "../helpers/images.js";
import { createMigratedTestPool, resetTables } from "../helpers/test-db.js";

let pool: pg.Pool;
let app: Express;
let storageDir: string;
let aliceToken: string;
let bobToken: string;

async function tokenFor(email: string): Promise<string> {
  await request(app).post("/register").send({ email, password: "motdepasse" });
  const login = await request(app).post("/login").send({ email, password: "motdepasse" });
  return (login.body as { token: string }).token;
}

async function uploadAs(token: string, file: Buffer): Promise<string> {
  const res = await request(app).post("/images").set("Authorization", `Bearer ${token}`).attach("image", file, "p.png");
  return (res.body as { id: string }).id;
}

beforeAll(async () => {
  pool = await createMigratedTestPool();
  storageDir = await mkdtemp(path.join(os.tmpdir(), "get-e2e-"));
  app = buildTestApp(pool, { storageDir });
});
beforeEach(async () => {
  await resetTables(pool);
  aliceToken = await tokenFor("alice@example.com");
  bobToken = await tokenFor("bob@example.com");
});
afterAll(async () => {
  await pool.end();
  await rm(storageDir, { recursive: true, force: true });
});

describe("GET /images/:id", () => {
  it("200 : renvoie exactement les octets envoyés, avec le bon Content-Type et Content-Length", async () => {
    const original = await makeImage("png", 40, 20);
    const id = await uploadAs(aliceToken, original);

    const res = await request(app).get(`/images/${id}`).set("Authorization", `Bearer ${aliceToken}`).responseType("blob");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["content-length"]).toBe(String(original.byteLength));
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect((res.body as Buffer).equals(original)).toBe(true);
  });

  it("sert chaque format avec son type MIME", async () => {
    for (const [format, mime] of [["jpeg", "image/jpeg"], ["webp", "image/webp"]] as const) {
      const id = await uploadAs(aliceToken, await makeImage(format));
      const res = await request(app).get(`/images/${id}`).set("Authorization", `Bearer ${aliceToken}`);
      expect(res.headers["content-type"]).toBe(mime);
    }
  });

  it("404 pour l'image d'un autre utilisateur, identique à une image inconnue (jamais 403)", async () => {
    const id = await uploadAs(aliceToken, await makeImage("png"));
    const asBob = await request(app).get(`/images/${id}`).set("Authorization", `Bearer ${bobToken}`);
    const unknown = await request(app)
      .get("/images/00000000-0000-4000-8000-000000000000")
      .set("Authorization", `Bearer ${bobToken}`);

    expect(asBob.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(asBob.body).toEqual(unknown.body);
  });

  it("404 pour un identifiant qui n'est pas un UUID (pas d'erreur 500)", async () => {
    const res = await request(app).get("/images/pas-un-uuid").set("Authorization", `Bearer ${aliceToken}`);
    expect(res.status).toBe(404);
  });

  it("401 sans jeton ou avec un jeton invalide", async () => {
    const id = await uploadAs(aliceToken, await makeImage("png"));
    expect((await request(app).get(`/images/${id}`)).status).toBe(401);
    expect((await request(app).get(`/images/${id}`).set("Authorization", "Bearer x.y.z")).status).toBe(401);
  });
});
