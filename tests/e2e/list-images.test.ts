/** Tests E2E de GET /images?page=&limit= : pagination, isolation entre utilisateurs, validation. */
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

interface ListBody {
  items: { id: string; format: string; storageKey?: string }[];
  page: number;
  limit: number;
  total: number;
}

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

async function uploadAs(token: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const res = await request(app).post("/images").set("Authorization", `Bearer ${token}`).attach("image", await makeImage("png", 10 + i, 10), "p.png");
    ids.push((res.body as { id: string }).id);
  }
  return ids;
}

function list(token: string, query = ""): request.Test {
  return request(app).get(`/images${query}`).set("Authorization", `Bearer ${token}`);
}

beforeAll(async () => {
  pool = await createMigratedTestPool();
  storageDir = await mkdtemp(path.join(os.tmpdir(), "list-e2e-"));
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

describe("GET /images", () => {
  it("200 avec les valeurs par défaut (page 1, limite 10) et une liste vide si aucune image", async () => {
    const res = await list(aliceToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], page: 1, limit: 10, total: 0 });
  });

  it("pagine : 25 images, limite 10 → pages de 10, 10 et 5, sans doublon", async () => {
    await uploadAs(aliceToken, 25);

    const first = (await list(aliceToken)).body as ListBody;
    const second = (await list(aliceToken, "?page=2&limit=10")).body as ListBody;
    const third = (await list(aliceToken, "?page=3&limit=10")).body as ListBody;
    const beyond = (await list(aliceToken, "?page=4&limit=10")).body as ListBody;

    expect([first.items.length, second.items.length, third.items.length, beyond.items.length]).toEqual([10, 10, 5, 0]);
    expect(first.total).toBe(25);
    expect(beyond).toMatchObject({ page: 4, limit: 10, total: 25 });
    const ids = [...first.items, ...second.items, ...third.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(25);
  });

  it("isolation : chaque utilisateur ne voit que ses images, total compris, sans clé de stockage", async () => {
    const aliceIds = await uploadAs(aliceToken, 3);
    await uploadAs(bobToken, 2);

    const alice = (await list(aliceToken)).body as ListBody;
    const bob = (await list(bobToken)).body as ListBody;

    expect(alice.total).toBe(3);
    expect(bob.total).toBe(2);
    expect(alice.items.map((i) => i.id).sort()).toEqual([...aliceIds].sort());
    expect(Object.keys(alice.items[0] ?? {}).sort()).toEqual(["createdAt", "format", "height", "id", "sizeBytes", "width"]);
  });

  it("accepte la limite maximale de 50", async () => {
    const res = await list(aliceToken, "?limit=50");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ limit: 50 });
  });

  it.each(["?page=0", "?page=-1", "?limit=0", "?limit=51", "?limit=-3", "?page=1.5", "?page=abc", "?limit=", "?page=1&page=2"])(
    "400 pour les paramètres hors bornes ou invalides %s",
    async (query) => {
      const res = await list(aliceToken, query);
      expect(res.status).toBe(400);
    },
  );

  it("401 sans jeton ou avec un jeton invalide", async () => {
    expect((await request(app).get("/images")).status).toBe(401);
    expect((await request(app).get("/images").set("Authorization", "Bearer x.y.z")).status).toBe(401);
  });
});
