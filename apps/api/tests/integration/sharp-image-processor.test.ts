/** Tests d'intégration de SharpImageProcessor avec de vraies images. */
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { isErr, isOk } from "../../src/domain/shared/result.js";
import { ImageFormat } from "../../src/domain/value-objects/image-format.js";
import { type RawTransformationInput, TransformationSet } from "../../src/domain/value-objects/transformation-set.js";
import { SharpImageProcessor } from "../../src/infrastructure/image/sharp-image-processor.js";
import { BLUE, brightness, GREEN, isCloseTo, makeImage, makeQuadrants, makeSolid, pixelAt, RED, YELLOW } from "../helpers/images.js";

describe("SharpImageProcessor", () => {
  const processor = new SharpImageProcessor();

  it.each(["jpeg", "png", "webp"] as const)("lit format et dimensions d'un %s", async (format) => {
    const result = await processor.readMetadata(await makeImage(format, 30, 12));
    expect(isOk(result) && result.value).toEqual({ format, width: 30, height: 12 });
  });

  it("tient compte de l'orientation EXIF (largeur et hauteur échangées)", async () => {
    const rotated = await sharp(await makeImage("jpeg", 30, 12)).withMetadata({ orientation: 6 }).toBuffer();
    const result = await processor.readMetadata(rotated);
    expect(isOk(result) && result.value).toMatchObject({ width: 12, height: 30 });
  });

  it("renvoie Err pour des données qui ne sont pas une image", async () => {
    expect(isErr(await processor.readMetadata(Buffer.from("pas une image")))).toBe(true);
    expect(isErr(await processor.readMetadata(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01])))).toBe(true);
  });
});

// Le JPEG est un format avec perte : près d'une zone colorée, le blanc dérive de quelques unités (sous-échantillonnage de la chrominance).
// 16 reste très loin du noir (0) que produisait le défaut « fond transparent supprimé à l'encodage ».
const WHITE_TOLERANCE = 16;

describe("SharpImageProcessor.transform", () => {
  const processor = new SharpImageProcessor();

  function transformationsOf(raw: RawTransformationInput): TransformationSet {
    const result = TransformationSet.create(raw, { maxSide: 8000 });
    if (!isOk(result)) throw new Error(`jeu de test invalide : ${result.error.reason}`);
    return result.value;
  }

  /** Applique la transformation sur le PNG des quadrants (40×20) et renvoie l'image produite. */
  async function run(raw: RawTransformationInput, outputFormat = ImageFormat.PNG, source?: Buffer) {
    const result = await processor.transform(source ?? (await makeQuadrants()), transformationsOf(raw), outputFormat);
    if (!isOk(result)) throw new Error("transformation échouée");
    return result.value;
  }

  describe("resize", () => {
    it("conserve le ratio quand une seule dimension est donnée", async () => {
      const out = await run({ resize: { width: 20 } });
      expect([out.width, out.height]).toEqual([20, 10]);
    });

    it("« cover » produit exactement la taille demandée, « fill » aussi, « inside » respecte le cadre", async () => {
      expect(await run({ resize: { width: 10, height: 10, fit: "cover" } })).toMatchObject({ width: 10, height: 10 });
      expect(await run({ resize: { width: 30, height: 30, fit: "fill" } })).toMatchObject({ width: 30, height: 30 });
      expect(await run({ resize: { width: 10, height: 10, fit: "inside" } })).toMatchObject({ width: 10, height: 5 });
    });

    it("peut agrandir l'image", async () => {
      expect(await run({ resize: { width: 80 } })).toMatchObject({ width: 80, height: 40 });
    });
  });

  describe("crop", () => {
    it("extrait la zone demandée : quadrant haut-gauche rouge, bas-droite jaune", async () => {
      const topLeft = await run({ crop: { x: 0, y: 0, width: 20, height: 10 } });
      expect([topLeft.width, topLeft.height]).toEqual([20, 10]);
      expect(await pixelAt(topLeft.data, 0, 0)).toEqual(RED);
      expect(await pixelAt(topLeft.data, 19, 9)).toEqual(RED);

      const bottomRight = await run({ crop: { x: 20, y: 10, width: 20, height: 10 } });
      expect(await pixelAt(bottomRight.data, 0, 0)).toEqual(YELLOW);
      expect(await pixelAt(bottomRight.data, 19, 9)).toEqual(YELLOW);
    });
  });

  describe("rotate, flip, mirror", () => {
    it("rotate 90 tourne dans le sens horaire : le rouge (haut-gauche) passe en haut-droite, le bleu en haut-gauche", async () => {
      const out = await run({ rotate: 90 });
      expect([out.width, out.height]).toEqual([20, 40]);
      expect(await pixelAt(out.data, 19, 0)).toEqual(RED);
      expect(await pixelAt(out.data, 0, 0)).toEqual(BLUE);
    });

    it("rotate -90 tourne dans le sens antihoraire : le rouge passe en bas-gauche", async () => {
      const out = await run({ rotate: -90 });
      expect([out.width, out.height]).toEqual([20, 40]);
      expect(await pixelAt(out.data, 0, 39)).toEqual(RED);
    });

    it("rotate 180 inverse tout : le rouge passe en bas-droite", async () => {
      const out = await run({ rotate: 180 });
      expect([out.width, out.height]).toEqual([40, 20]);
      expect(await pixelAt(out.data, 39, 19)).toEqual(RED);
    });

    it("flip retourne verticalement (rouge et bleu échangés), mirror horizontalement (rouge et vert échangés)", async () => {
      const flipped = await run({ flip: true });
      expect(await pixelAt(flipped.data, 0, 0)).toEqual(BLUE);
      expect(await pixelAt(flipped.data, 0, 19)).toEqual(RED);

      const mirrored = await run({ mirror: true });
      expect(await pixelAt(mirrored.data, 0, 0)).toEqual(GREEN);
      expect(await pixelAt(mirrored.data, 39, 0)).toEqual(RED);
    });

    it("flip et mirror ensemble équivalent à une rotation de 180°", async () => {
      const both = await run({ flip: true, mirror: true });
      expect(await pixelAt(both.data, 39, 19)).toEqual(RED);
      expect(await pixelAt(both.data, 0, 0)).toEqual(YELLOW);
    });

    it("une rotation d'angle libre agrandit le canevas ; les coins vides sont transparents en PNG et WebP, blancs en JPEG", async () => {
      const png = await run({ rotate: 45 });
      expect(png.width).toBeGreaterThan(40);
      expect((await pixelAt(png.data, 0, 0))[3]).toBe(0);

      const webp = await run({ rotate: 45 }, ImageFormat.WEBP);
      expect((await pixelAt(webp.data, 0, 0))[3]).toBe(0);

      const jpeg = await run({ rotate: 45 }, ImageFormat.JPEG);
      expect(isCloseTo(await pixelAt(jpeg.data, 0, 0), [255, 255, 255, 255], WHITE_TOLERANCE)).toBe(true);
    });

    it("les marges d'un resize « contain » sont blanches en JPEG, transparentes en PNG", async () => {
      const raw = { resize: { width: 40, height: 40, fit: "contain" } };
      const jpeg = await run(raw, ImageFormat.JPEG);
      expect(isCloseTo(await pixelAt(jpeg.data, 20, 0), [255, 255, 255, 255], WHITE_TOLERANCE)).toBe(true);
      const png = await run(raw);
      expect((await pixelAt(png.data, 20, 0))[3]).toBe(0);
    });

    it("une source PNG transparente convertie en JPEG est aplatie sur du blanc", async () => {
      const transparent = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
      const out = await run({ format: "jpeg" }, ImageFormat.JPEG, transparent);
      expect(isCloseTo(await pixelAt(out.data, 5, 5), [255, 255, 255, 255], WHITE_TOLERANCE)).toBe(true);
    });
  });

  describe("ordre des opérations : crop → rotate → resize", () => {
    it("le crop s'applique AVANT la rotation, dans les coordonnées de la source", async () => {
      // Moitié haute (rouge | vert) puis rotation horaire : le rouge passe en haut, le vert en bas.
      const out = await run({ crop: { x: 0, y: 0, width: 40, height: 10 }, rotate: 90 });
      expect([out.width, out.height]).toEqual([10, 40]);
      expect(await pixelAt(out.data, 0, 0)).toEqual(RED);
      expect(await pixelAt(out.data, 0, 39)).toEqual(GREEN);
    });

    it("le resize s'applique APRÈS la rotation", async () => {
      // Rotation -> 20×40, puis largeur 10 -> 10×20. (Resize avant : 10×5 puis rotation -> 5×10.)
      const out = await run({ rotate: 90, resize: { width: 10 } });
      expect([out.width, out.height]).toEqual([10, 20]);
    });

    it("le filtre s'applique en dernier, sur le résultat redimensionné", async () => {
      const out = await run({ resize: { width: 20 }, filter: "grayscale" });
      expect([out.width, out.height]).toEqual([20, 10]);
      const [r, g, b] = await pixelAt(out.data, 2, 2);
      expect(r === g && g === b).toBe(true);
    });
  });

  describe("filtres", () => {
    it("grayscale : tous les pixels ont des canaux R, G et B égaux", async () => {
      const out = await run({ filter: "grayscale" });
      for (const [x, y] of [[1, 1], [38, 1], [1, 18], [38, 18]] as const) {
        const [r, g, b] = await pixelAt(out.data, x, y);
        expect(r === g && g === b).toBe(true);
      }
    });

    it("sepia : teinte brune (R > G > B), valeurs de la matrice classique pour le rouge pur", async () => {
      const out = await run({ filter: "sepia" });
      const [r, g, b] = await pixelAt(out.data, 1, 1);
      expect(r).toBeGreaterThan(g);
      expect(g).toBeGreaterThan(b);
      expect(isCloseTo([r, g, b, 255], [100, 89, 69, 255], 3)).toBe(true);
    });
  });

  describe("format et qualité", () => {
    it.each([
      [ImageFormat.JPEG, "jpeg"],
      [ImageFormat.PNG, "png"],
      [ImageFormat.WEBP, "webp"],
    ] as const)("convertit vers %s : le contenu produit est bien de ce format", async (format, name) => {
      const out = await run({ format: name }, format);
      expect(out.format).toBe(format);
      expect(ImageFormat.fromMagicBytes(out.data)).toBe(format);
      expect([out.width, out.height]).toEqual([40, 20]);
    });

    it.each([ImageFormat.JPEG, ImageFormat.WEBP])("une qualité plus basse donne un fichier plus léger en %s", async (format) => {
      const noise = await sharp(randomBytes(200 * 200 * 3), { raw: { width: 200, height: 200, channels: 3 } }).png().toBuffer();
      const low = await run({ quality: 10 }, format, noise);
      const high = await run({ quality: 95 }, format, noise);
      expect(low.data.byteLength).toBeLessThan(high.data.byteLength);
    });
  });

  describe("métadonnées", () => {
    it("applique l'orientation EXIF puis supprime TOUTES les métadonnées du résultat", async () => {
      const tagged = await sharp(await makeImage("jpeg", 30, 12)).withMetadata({ orientation: 6 }).toBuffer();
      const before = await sharp(tagged).metadata();
      expect(before.orientation).toBe(6);
      expect(before.exif).toBeDefined();

      const out = await run({ filter: "grayscale" }, ImageFormat.JPEG, tagged);
      const after = await sharp(out.data).metadata();
      expect([out.width, out.height]).toEqual([12, 30]);
      expect(after.exif).toBeUndefined();
      expect(after.orientation).toBeUndefined();
    });
  });

  describe("sûreté", () => {
    it("ne modifie jamais les données source", async () => {
      const source = await makeQuadrants();
      const copy = Buffer.from(source);
      await run({ rotate: 90, filter: "sepia", resize: { width: 5 } }, ImageFormat.JPEG, source);
      expect(source.equals(copy)).toBe(true);
    });

    it("renvoie Err pour une source illisible", async () => {
      const result = await processor.transform(Buffer.from("pas une image"), transformationsOf({ flip: true }), ImageFormat.PNG);
      expect(isErr(result)).toBe(true);
    });

    it("refuse de décoder une image au-delà de la limite de pixels configurée", async () => {
      const limited = new SharpImageProcessor({ limitInputPixels: 100 });
      const result = await limited.transform(await makeQuadrants(40, 20), transformationsOf({ flip: true }), ImageFormat.PNG);
      expect(isErr(result)).toBe(true);
    });
  });

  describe("filigrane", () => {
    // Fond noir 300×150 : tout pixel clair vient du filigrane (texte blanc).
    const W = 300;
    const H = 150;
    const quadrant = (right: boolean, bottom: boolean) => ({ x: right ? W / 2 : 0, y: bottom ? H / 2 : 0, width: W / 2, height: H / 2 });
    const watermarked = async (watermark: NonNullable<RawTransformationInput["watermark"]>, extra: RawTransformationInput = {}) =>
      run({ watermark, ...extra }, ImageFormat.PNG, await makeSolid(W, H, "#000000"));

    it.each([
      ["top-left", false, false],
      ["top-right", true, false],
      ["bottom-left", false, true],
      ["bottom-right", true, true],
    ] as const)("position %s : le texte apparaît dans le bon coin et pas dans le coin opposé", async (position, right, bottom) => {
      const out = await watermarked({ text: "Hello", position, opacity: 1 });
      expect((await brightness(out.data, quadrant(right, bottom))).bright).toBeGreaterThan(50);
      expect((await brightness(out.data, quadrant(!right, !bottom))).bright).toBe(0);
    });

    it("center : le texte est au milieu de l'image, pas dans les coins", async () => {
      const out = await watermarked({ text: "Hello", position: "center", opacity: 1 });
      expect((await brightness(out.data, { x: 60, y: 50, width: 180, height: 50 })).bright).toBeGreaterThan(50);
      expect((await brightness(out.data, { x: 0, y: 0, width: 60, height: 40 })).bright).toBe(0);
      expect((await brightness(out.data, { x: 240, y: 110, width: 60, height: 40 })).bright).toBe(0);
    });

    it("ne change ni les dimensions ni le format de l'image", async () => {
      const out = await watermarked({ text: "Hello" });
      expect([out.width, out.height]).toEqual([W, H]);
      expect(ImageFormat.fromMagicBytes(out.data)).toBe(ImageFormat.PNG);
    });

    it("l'opacité règle la force du filigrane : 0,2 reste très sombre, 1 est blanc franc", async () => {
      const faint = await watermarked({ text: "Hello", position: "center", opacity: 0.2 });
      const strong = await watermarked({ text: "Hello", position: "center", opacity: 1 });
      expect((await brightness(faint.data)).max).toBeLessThan(90);
      expect((await brightness(faint.data)).max).toBeGreaterThan(20);
      expect((await brightness(strong.data)).max).toBeGreaterThan(220);
    });

    it("sans filigrane, l'image reste uniformément noire (le test de position est donc discriminant)", async () => {
      const out = await run({ flip: true }, ImageFormat.PNG, await makeSolid(W, H, "#000000"));
      expect((await brightness(out.data)).max).toBe(0);
    });

    it("le filigrane est posé APRÈS le resize : il suit la taille finale et reste entièrement dans l'image", async () => {
      const out = await watermarked({ text: "Hello World", position: "bottom-right", opacity: 1 }, { resize: { width: 100 } });
      expect([out.width, out.height]).toEqual([100, 50]);
      expect((await brightness(out.data, { x: 40, y: 25, width: 60, height: 25 })).bright).toBeGreaterThan(10);
      expect((await brightness(out.data, { x: 0, y: 0, width: 50, height: 25 })).bright).toBe(0);
    });

    it("le filigrane est posé APRÈS le filtre : il garde sa couleur blanche sur un fond sépia", async () => {
      const out = await run({ filter: "sepia", watermark: { text: "Hello", position: "center", opacity: 1 } }, ImageFormat.PNG, await makeSolid(W, H, "#ff0000"));
      expect(isCloseTo(await pixelAt(out.data, 2, 2), [100, 89, 69, 255], 3)).toBe(true);
      expect((await brightness(out.data, { x: 60, y: 50, width: 180, height: 50 })).max).toBeGreaterThan(220);
    });

    it("fonctionne avec une image en niveaux de gris et en sortie JPEG ou WebP", async () => {
      for (const format of [ImageFormat.JPEG, ImageFormat.WEBP]) {
        const out = await run({ filter: "grayscale", watermark: { text: "Hello", position: "center", opacity: 1 } }, format, await makeSolid(W, H, "#000000"));
        expect(out.format).toBe(format);
        expect((await brightness(out.data, { x: 60, y: 50, width: 180, height: 50 })).bright).toBeGreaterThan(50);
      }
    });

    it("rend sans erreur un texte contenant & et ' (échappés dans le SVG), et des accents", async () => {
      const out = await watermarked({ text: "Tom & Jerry's Café", position: "center", opacity: 1 });
      expect((await brightness(out.data, { x: 20, y: 50, width: 260, height: 50 })).bright).toBeGreaterThan(50);
    });

    it("conserve la transparence d'un PNG source en sortie PNG", async () => {
      const transparent = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
      const out = await run({ watermark: { text: "Hello", position: "center", opacity: 1 } }, ImageFormat.PNG, transparent);
      expect((await pixelAt(out.data, 1, 1))[3]).toBe(0);
      expect((await brightness(out.data, { x: 60, y: 50, width: 180, height: 50 })).bright).toBeGreaterThan(50);
    });
  });
});
