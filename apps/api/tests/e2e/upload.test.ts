/** Tests E2E de POST /images : HTTP → auth → multer → use case → sharp → disque + PostgreSQL. */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Express } from "express";
import type pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";
import { makeImage } from "../helpers/images.js";
import { createMigratedTestPool, resetTables } from "../helpers/test-db.js";

const MAX_BYTES = 50_000;
let pool: pg.Pool;
let app: Express;
let storageDir: string;
let token: string;

async function storedFiles(): Promise<string[]> {
  try {
    return await readdir(path.join(storageDir, "originals"));
  } catch {
    return [];
  }
}

beforeAll(async () => {
  pool = await createMigratedTestPool();
  storageDir = await mkdtemp(path.join(os.tmpdir(), "upload-e2e-"));
  app = buildTestApp(pool, { storageDir, maxUploadBytes: MAX_BYTES, maxPixelsSide: 8000 });
});
beforeEach(async () => {
  await resetTables(pool);
  await rm(path.join(storageDir, "originals"), { recursive: true, force: true });
  await request(app).post("/register").send({ email: "a@b.co", password: "motdepasse" });
  const login = await request(app).post("/login").send({ email: "a@b.co", password: "motdepasse" });
  token = (login.body as { token: string }).token;
});
afterAll(async () => {
  await pool.end();
  await rm(storageDir, { recursive: true, force: true });
});

function upload(file: Buffer, filename = "photo.jpg", contentType = "image/jpeg"): request.Test {
  return request(app).post("/images").set("Authorization", `Bearer ${token}`).attach("image", file, { filename, contentType });
}

describe("POST /images", () => {
  it.each([
    ["jpeg", "jpeg"],
    ["png", "png"],
    ["webp", "webp"],
  ] as const)("201 pour un vrai %s : métadonnées renvoyées, fichier sur disque, ligne en base", async (format, expected) => {
    const res = await upload(await makeImage(format, 40, 20), `photo.${format}`, `image/${format}`);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ format: expected, width: 40, height: 20 });
    expect(Object.keys(res.body as object).sort()).toEqual(["createdAt", "format", "height", "id", "originalId", "sizeBytes", "width"]);

    const files = await storedFiles();
    expect(files).toHaveLength(1);
    const row = await pool.query<{ storage_key: string; owner_id: string; original_id: string | null }>(
      "SELECT storage_key, owner_id, original_id FROM images WHERE id = $1",
      [(res.body as { id: string }).id],
    );
    expect(row.rows[0]?.storage_key).toMatch(new RegExp(`^originals/[0-9a-f-]{36}\\.`));
    expect(row.rows[0]?.original_id).toBeNull();
  });

  it("le type est déduit des magic bytes : nom, extension et Content-Type mensongers sont ignorés, le nom client n'est jamais utilisé", async () => {
    const res = await upload(await makeImage("png"), "../../evil.txt", "text/plain");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ format: "png" });

    const files = await storedFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f-]{36}\.png$/);
  });

  it("415 pour un faux .jpg (contenu texte) et pour un GIF ; rien n'est stocké", async () => {
    const fake = await upload(Buffer.from("ceci n'est pas une image"), "photo.jpg", "image/jpeg");
    expect(fake.status).toBe(415);
    expect(fake.body).toMatchObject({ error: "UnsupportedImageFormat" });

    const gif = await upload(Buffer.from("GIF89a\x01\x00\x01\x00"), "anim.gif", "image/gif");
    expect(gif.status).toBe(415);
    expect(await storedFiles()).toHaveLength(0);
    expect((await pool.query("SELECT 1 FROM images")).rowCount).toBe(0);
  });

  it("400 pour une image corrompue (en-tête JPEG puis du bruit)", async () => {
    const res = await upload(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "CorruptedImage" });
    expect(await storedFiles()).toHaveLength(0);
  });

  it("413 pour un fichier trop lourd (limite de poids)", async () => {
    const res = await upload(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MAX_BYTES)]));
    expect(res.status).toBe(413);
    expect(await storedFiles()).toHaveLength(0);
  });

  it("413 pour une image trop large même si son poids est faible (limite de dimensions)", async () => {
    const wide = await makeImage("png", 8001, 1);
    expect(wide.byteLength).toBeLessThan(MAX_BYTES);
    const res = await upload(wide, "wide.png", "image/png");
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ error: "ImageDimensionsTooLarge" });
    expect(await storedFiles()).toHaveLength(0);
  });

  it("401 sans jeton ou avec un jeton invalide", async () => {
    const file = await makeImage("jpeg");
    expect((await request(app).post("/images").attach("image", file, "p.jpg")).status).toBe(401);
    const bad = await request(app).post("/images").set("Authorization", "Bearer pas.un.jwt").attach("image", file, "p.jpg");
    expect(bad.status).toBe(401);
  });

  it("400 sans fichier, ou avec un mauvais nom de champ", async () => {
    const none = await request(app)
      .post("/images")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "multipart/form-data; boundary=x")
      .send("--x--\r\n");
    expect(none.status).toBe(400);
    expect(none.body).toMatchObject({ error: "MissingFile" });
    const wrongField = await request(app)
      .post("/images")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", await makeImage("jpeg"), "p.jpg");
    expect(wrongField.status).toBe(400);
  });
});
