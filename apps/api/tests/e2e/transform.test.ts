/** Tests E2E de POST /images/:id/transform : upload, transformation, relecture, isolation, validation. */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Express } from "express";
import type pg from "pg";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ImageFormat } from "../../src/domain/value-objects/image-format.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { BLUE, brightness, isCloseTo, makeImage, makeQuadrants, makeSolid, pixelAt, RED } from "../helpers/images.js";
import { createMigratedTestPool, resetTables } from "../helpers/test-db.js";

interface Summary {
  id: string;
  originalId: string | null;
  format: string;
  width: number;
  height: number;
  sizeBytes: number;
}

const MAX_SIDE = 200;
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

async function uploadAs(token: string, file: Buffer): Promise<Summary> {
  const res = await request(app).post("/images").set("Authorization", `Bearer ${token}`).attach("image", file, "p.png");
  return res.body as Summary;
}

function transform(token: string, id: string, body: object): request.Test {
  return request(app).post(`/images/${id}/transform`).set("Authorization", `Bearer ${token}`).send(body);
}

async function download(token: string, id: string): Promise<{ type: string; bytes: Buffer }> {
  const res = await request(app).get(`/images/${id}`).set("Authorization", `Bearer ${token}`).responseType("blob");
  return { type: res.headers["content-type"] as string, bytes: res.body as Buffer };
}

beforeAll(async () => {
  pool = await createMigratedTestPool();
  storageDir = await mkdtemp(path.join(os.tmpdir(), "transform-e2e-"));
  app = buildTestApp(pool, { storageDir, maxPixelsSide: MAX_SIDE });
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

describe("POST /images/:id/transform", () => {
  it("201 : crée un dérivé webp redimensionné, relisible avec le bon type, rattaché à l'original", async () => {
    const original = await makeQuadrants(40, 20);
    const source = await uploadAs(aliceToken, original);

    const res = await transform(aliceToken, source.id, { resize: { width: 20 }, format: "webp" });
    const derived = res.body as Summary;

    expect(res.status).toBe(201);
    expect(derived).toMatchObject({ originalId: source.id, format: "webp", width: 20, height: 10 });
    expect(derived.id).not.toBe(source.id);

    const file = await download(aliceToken, derived.id);
    expect(file.type).toBe("image/webp");
    expect(ImageFormat.fromMagicBytes(file.bytes)).toBe(ImageFormat.WEBP);
    expect((await sharp(file.bytes).metadata()).width).toBe(20);
  });

  it("l'original n'est JAMAIS modifié : mêmes octets avant et après plusieurs transformations", async () => {
    const original = await makeQuadrants(40, 20);
    const source = await uploadAs(aliceToken, original);

    await transform(aliceToken, source.id, { rotate: 90, filter: "sepia" });
    await transform(aliceToken, source.id, { crop: { x: 0, y: 0, width: 10, height: 10 }, format: "jpeg" });

    const after = await download(aliceToken, source.id);
    expect(after.bytes.equals(original)).toBe(true);
  });

  it("applique les opérations dans le bon sens : rotation de 90° horaire et crop du quadrant haut-gauche", async () => {
    const source = await uploadAs(aliceToken, await makeQuadrants(40, 20));

    const rotated = (await transform(aliceToken, source.id, { rotate: 90 })).body as Summary;
    expect([rotated.width, rotated.height]).toEqual([20, 40]);
    const rotatedFile = await download(aliceToken, rotated.id);
    expect(await pixelAt(rotatedFile.bytes, 19, 0)).toEqual(RED);
    expect(await pixelAt(rotatedFile.bytes, 0, 0)).toEqual(BLUE);

    const cropped = (await transform(aliceToken, source.id, { crop: { x: 0, y: 0, width: 20, height: 10 } })).body as Summary;
    expect([cropped.width, cropped.height]).toEqual([20, 10]);
    expect(await pixelAt((await download(aliceToken, cropped.id)).bytes, 5, 5)).toEqual(RED);
  });

  it("flip, mirror, grayscale et conversion jpeg fonctionnent via l'API", async () => {
    const source = await uploadAs(aliceToken, await makeQuadrants(40, 20));

    const flipped = (await transform(aliceToken, source.id, { flip: true })).body as Summary;
    expect(await pixelAt((await download(aliceToken, flipped.id)).bytes, 0, 0)).toEqual(BLUE);

    const gray = (await transform(aliceToken, source.id, { filter: "grayscale", format: "jpeg", quality: 90 })).body as Summary;
    expect(gray.format).toBe("jpeg");
    const [r, g, b] = await pixelAt((await download(aliceToken, gray.id)).bytes, 2, 2);
    expect(isCloseTo([r, g, b, 255], [g, g, g, 255], 3)).toBe(true);
  });

  it("supprime les métadonnées (EXIF) du dérivé", async () => {
    const tagged = await sharp(await makeImage("jpeg", 30, 12)).withMetadata({ orientation: 6 }).toBuffer();
    const upload = await request(app).post("/images").set("Authorization", `Bearer ${aliceToken}`).attach("image", tagged, "p.jpg");
    const source = upload.body as Summary;
    expect(source.width).toBe(12);

    const derived = (await transform(aliceToken, source.id, { filter: "grayscale" })).body as Summary;
    const file = await download(aliceToken, derived.id);
    const meta = await sharp(file.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect([derived.width, derived.height]).toEqual([12, 30]);
  });

  it("le dérivé apparaît dans la liste avec originalId ; transformer un dérivé pointe vers l'original racine", async () => {
    const source = await uploadAs(aliceToken, await makeQuadrants(40, 20));
    const first = (await transform(aliceToken, source.id, { rotate: 90 })).body as Summary;
    const second = (await transform(aliceToken, first.id, { flip: true })).body as Summary;
    expect(second.originalId).toBe(source.id);

    const list = (await request(app).get("/images").set("Authorization", `Bearer ${aliceToken}`)).body as { items: Summary[]; total: number };
    expect(list.total).toBe(3);
    const byId = new Map(list.items.map((item) => [item.id, item.originalId]));
    expect(byId.get(source.id)).toBeNull();
    expect(byId.get(first.id)).toBe(source.id);
    expect(byId.get(second.id)).toBe(source.id);
  });

  it("404 pour l'image d'un autre utilisateur, identique à une image inconnue (jamais 403) ; aucun dérivé créé", async () => {
    const source = await uploadAs(aliceToken, await makeQuadrants(40, 20));
    const asBob = await transform(bobToken, source.id, { rotate: 90 });
    const unknown = await transform(bobToken, "00000000-0000-4000-8000-000000000000", { rotate: 90 });

    expect(asBob.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(asBob.body).toEqual(unknown.body);
    expect((await pool.query("SELECT 1 FROM images")).rowCount).toBe(1);
  });

  it("404 pour un identifiant qui n'est pas un UUID", async () => {
    expect((await transform(aliceToken, "pas-un-uuid", { rotate: 90 })).status).toBe(404);
  });

  it("401 sans jeton ou avec un jeton invalide", async () => {
    const source = await uploadAs(aliceToken, await makeQuadrants(40, 20));
    expect((await request(app).post(`/images/${source.id}/transform`).send({ rotate: 90 })).status).toBe(401);
    expect((await request(app).post(`/images/${source.id}/transform`).set("Authorization", "Bearer x.y.z").send({ rotate: 90 })).status).toBe(401);
  });

  it.each([
    ["corps vide", {}],
    ["opérations sans effet", { rotate: 0, flip: false }],
    ["champ inconnu", { rotate: 90, blur: 5 }],
    ["rotation hors bornes", { rotate: 361 }],
    ["rotation non entière", { rotate: 12.5 }],
    ["mauvais type", { rotate: "90" }],
    ["resize sans dimension", { resize: { fit: "cover" } }],
    ["resize au-delà de la limite", { resize: { width: MAX_SIDE + 1 } }],
    ["resize fit inconnu", { resize: { width: 10, fit: "stretch" } }],
    ["crop incomplet", { crop: { x: 0, y: 0 } }],
    ["crop hors de l'image (40×20)", { crop: { x: 30, y: 0, width: 20, height: 10 } }],
    ["crop négatif", { crop: { x: -1, y: 0, width: 5, height: 5 } }],
    ["filtre inconnu", { filter: "blur" }],
    ["format inconnu", { format: "gif" }],
    ["qualité hors bornes", { quality: 101 }],
    ["qualité sur une sortie PNG (source PNG)", { quality: 80 }],
  ])("400 : %s", async (_name, body) => {
    const source = await uploadAs(aliceToken, await makeQuadrants(40, 20));
    const res = await transform(aliceToken, source.id, body);
    expect(res.status).toBe(400);
    expect((await pool.query("SELECT 1 FROM images")).rowCount).toBe(1);
  });

  it("400 si le résultat dépasse la limite par côté (rotation à 45° d'une image de 150×150, limite 200)", async () => {
    const big = await sharp({ create: { width: 150, height: 150, channels: 3, background: "#888" } }).png().toBuffer();
    const source = await uploadAs(aliceToken, big);
    const res = await transform(aliceToken, source.id, { rotate: 45 });
    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toContain("dépasse");

    const withResize = await transform(aliceToken, source.id, { rotate: 45, resize: { width: 100 } });
    expect(withResize.status).toBe(201);
  });

  it("400 pour un JSON malformé", async () => {
    const source = await uploadAs(aliceToken, await makeQuadrants(40, 20));
    const res = await request(app)
      .post(`/images/${source.id}/transform`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .set("Content-Type", "application/json")
      .send("{pas du json");
    expect(res.status).toBe(400);
  });

  it("autorise la qualité quand la sortie est jpeg ou webp, même si la source est un PNG", async () => {
    const source = await uploadAs(aliceToken, await makeQuadrants(40, 20));
    expect((await transform(aliceToken, source.id, { quality: 50, format: "jpeg" })).status).toBe(201);
    expect((await transform(aliceToken, source.id, { quality: 50, format: "webp" })).status).toBe(201);
  });
});

describe("POST /images/:id/transform : filigrane", () => {
  it("201 : le filigrane texte est dessiné dans le coin demandé du dérivé, l'original reste intact", async () => {
    const black = await makeSolid(200, 100, "#000000");
    const source = await uploadAs(aliceToken, black);

    const res = await transform(aliceToken, source.id, { watermark: { text: "© Alice", position: "top-left", opacity: 1 } });
    const derived = res.body as Summary;
    expect(res.status).toBe(201);
    expect(derived).toMatchObject({ originalId: source.id, format: "png", width: 200, height: 100 });

    const file = await download(aliceToken, derived.id);
    expect((await brightness(file.bytes, { x: 0, y: 0, width: 100, height: 50 })).bright).toBeGreaterThan(50);
    expect((await brightness(file.bytes, { x: 100, y: 50, width: 100, height: 50 })).bright).toBe(0);
    expect((await download(aliceToken, source.id)).bytes.equals(black)).toBe(true);
  });

  it("position par défaut : en bas à droite ; combiné avec resize, format et qualité", async () => {
    const source = await uploadAs(aliceToken, await makeSolid(200, 100, "#000000"));
    const res = await transform(aliceToken, source.id, { resize: { width: 100 }, watermark: { text: "Hello", opacity: 1 }, format: "webp", quality: 90 });
    const derived = res.body as Summary;
    expect(res.status).toBe(201);
    expect([derived.format, derived.width, derived.height]).toEqual(["webp", 100, 50]);

    const file = await download(aliceToken, derived.id);
    expect((await brightness(file.bytes, { x: 50, y: 25, width: 50, height: 25 })).bright).toBeGreaterThan(5);
    expect((await brightness(file.bytes, { x: 0, y: 0, width: 50, height: 25 })).bright).toBe(0);
  });

  it("accepte un texte avec & et ' sans casser le rendu", async () => {
    const source = await uploadAs(aliceToken, await makeSolid(200, 100, "#000000"));
    const res = await transform(aliceToken, source.id, { watermark: { text: "Tom & Jerry's", position: "center", opacity: 1 } });
    expect(res.status).toBe(201);
  });

  it.each([
    ["texte vide", { watermark: { text: "" } }],
    ["texte d'espaces", { watermark: { text: "     " } }],
    ["texte de 31 caractères", { watermark: { text: "a".repeat(31) } }],
    ["injection de balise", { watermark: { text: "</text><script>alert(1)</script>" } }],
    ["balise SVG", { watermark: { text: "<svg onload=alert(1)>" } }],
    ["guillemet double", { watermark: { text: 'a" onclick="x' } }],
    ["saut de ligne", { watermark: { text: "a\nb" } }],
    ["emoji", { watermark: { text: "😀" } }],
    ["texte manquant", { watermark: { position: "center" } }],
    ["texte du mauvais type", { watermark: { text: 123 } }],
    ["position inconnue", { watermark: { text: "ok", position: "milieu" } }],
    ["opacité trop faible", { watermark: { text: "ok", opacity: 0.05 } }],
    ["opacité trop forte", { watermark: { text: "ok", opacity: 1.5 } }],
    ["opacité du mauvais type", { watermark: { text: "ok", opacity: "0.5" } }],
    ["champ inconnu dans le filigrane", { watermark: { text: "ok", font: "Comic Sans" } }],
    ["filigrane qui n'est pas un objet", { watermark: "ok" }],
  ])("400 : %s", async (_name, body) => {
    const source = await uploadAs(aliceToken, await makeSolid(200, 100, "#000000"));
    const res = await transform(aliceToken, source.id, body);
    expect(res.status).toBe(400);
    expect((await pool.query("SELECT 1 FROM images")).rowCount).toBe(1);
  });

  it("404 pour le filigrane sur l'image d'un autre utilisateur ; 401 sans jeton", async () => {
    const source = await uploadAs(aliceToken, await makeSolid(200, 100, "#000000"));
    expect((await transform(bobToken, source.id, { watermark: { text: "x" } })).status).toBe(404);
    expect((await request(app).post(`/images/${source.id}/transform`).send({ watermark: { text: "x" } })).status).toBe(401);
  });
});
