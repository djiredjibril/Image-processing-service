/** Tests unitaires des value objects de transformation (bornes et valeurs autorisées). */
import { describe, expect, it } from "vitest";
import { isErr, isOk } from "../../../src/domain/shared/result.js";
import { CropParams } from "../../../src/domain/value-objects/crop-params.js";
import { ImageDimensions } from "../../../src/domain/value-objects/image-dimensions.js";
import { ImageFilter } from "../../../src/domain/value-objects/image-filter.js";
import { ImageFormat } from "../../../src/domain/value-objects/image-format.js";
import { Quality } from "../../../src/domain/value-objects/quality.js";
import { ResizeParams } from "../../../src/domain/value-objects/resize-params.js";
import { Rotation } from "../../../src/domain/value-objects/rotation.js";
import { type RawTransformationInput, TransformationSet } from "../../../src/domain/value-objects/transformation-set.js";

const MAX = 8000;

function dims(width: number, height: number): ImageDimensions {
  const result = ImageDimensions.create(width, height);
  if (!isOk(result)) throw new Error("dimensions de test invalides");
  return result.value;
}

describe("Rotation", () => {
  it("accepte les entiers de -360 à 360, bornes incluses", () => {
    for (const degrees of [-360, -45, 0, 1, 45, 90, 360]) expect(isOk(Rotation.create(degrees))).toBe(true);
  });

  it.each([361, -361, 45.5, Number.NaN, Number.POSITIVE_INFINITY])("refuse %s", (degrees) => {
    const result = Rotation.create(degrees);
    expect(isErr(result) && result.error.kind).toBe("InvalidTransformation");
  });

  it("reconnaît les rotations sans effet (0, 360, -360)", () => {
    for (const degrees of [0, 360, -360]) {
      const result = Rotation.create(degrees);
      expect(isOk(result) && result.value.isIdentity).toBe(true);
    }
    const result = Rotation.create(90);
    expect(isOk(result) && result.value.isIdentity).toBe(false);
  });
});

describe("CropParams", () => {
  it("accepte une zone valide et teste son appartenance à l'image, bords inclus", () => {
    const crop = CropParams.create({ x: 10, y: 5, width: 30, height: 15 });
    if (!isOk(crop)) throw new Error("crop de test invalide");
    expect(crop.value.fitsWithin(dims(40, 20))).toBe(true);
    expect(crop.value.fitsWithin(dims(39, 20))).toBe(false);
    expect(crop.value.fitsWithin(dims(40, 19))).toBe(false);
  });

  it.each([
    { x: -1, y: 0, width: 5, height: 5 },
    { x: 0, y: -1, width: 5, height: 5 },
    { x: 0, y: 0, width: 0, height: 5 },
    { x: 0, y: 0, width: 5, height: 0 },
    { x: 0.5, y: 0, width: 5, height: 5 },
    { x: 0, y: 0, width: 5.5, height: 5 },
    { x: Number.NaN, y: 0, width: 5, height: 5 },
  ])("refuse %j", (raw) => {
    expect(isErr(CropParams.create(raw))).toBe(true);
  });
});

describe("ResizeParams", () => {
  it("accepte largeur seule, hauteur seule ou les deux, avec « inside » par défaut", () => {
    const widthOnly = ResizeParams.create({ width: 100 }, MAX);
    expect(isOk(widthOnly) && [widthOnly.value.width, widthOnly.value.height, widthOnly.value.fit]).toEqual([100, null, "inside"]);
    expect(isOk(ResizeParams.create({ height: 50 }, MAX))).toBe(true);
    expect(isOk(ResizeParams.create({ width: MAX, height: MAX, fit: "cover" }, MAX))).toBe(true);
  });

  it("refuse l'absence de dimension, les bornes dépassées et les valeurs non entières", () => {
    for (const raw of [{}, { fit: "cover" }, { width: 0 }, { width: MAX + 1 }, { height: -5 }, { width: 1.5 }, { height: Number.NaN }]) {
      expect(isErr(ResizeParams.create(raw, MAX))).toBe(true);
    }
  });

  it("n'accepte que les modes d'ajustement connus", () => {
    for (const fit of ["cover", "contain", "fill", "inside", "outside"]) expect(isOk(ResizeParams.create({ width: 10, fit }, MAX))).toBe(true);
    expect(isErr(ResizeParams.create({ width: 10, fit: "stretch" }, MAX))).toBe(true);
  });
});

describe("ImageFilter et Quality", () => {
  it("n'accepte que grayscale et sepia", () => {
    expect(isOk(ImageFilter.create("grayscale"))).toBe(true);
    expect(isOk(ImageFilter.create("sepia"))).toBe(true);
    for (const raw of ["blur", "", "GRAYSCALE"]) expect(isErr(ImageFilter.create(raw))).toBe(true);
  });

  it("accepte la qualité de 1 à 100 seulement", () => {
    for (const value of [1, 50, 100]) expect(isOk(Quality.create(value))).toBe(true);
    for (const value of [0, 101, -1, 80.5, Number.NaN]) expect(isErr(Quality.create(value))).toBe(true);
  });
});

describe("TransformationSet", () => {
  const create = (raw: RawTransformationInput): ReturnType<typeof TransformationSet.create> => TransformationSet.create(raw, { maxSide: MAX });

  it("construit un jeu complet valide", () => {
    const result = create({
      crop: { x: 0, y: 0, width: 10, height: 10 },
      rotate: 90,
      flip: true,
      mirror: true,
      resize: { width: 5, fit: "cover" },
      filter: "sepia",
      format: "webp",
      quality: 70,
    });
    expect(isOk(result)).toBe(true);
  });

  it("refuse un jeu vide, ou ne contenant que des valeurs sans effet", () => {
    for (const raw of [{}, { flip: false }, { mirror: false }, { rotate: 0 }, { rotate: 360, flip: false }]) {
      const result = create(raw);
      expect(isErr(result) && result.error.reason).toContain("aucune transformation");
    }
  });

  it("accepte une opération seule, y compris la qualité ou le format", () => {
    for (const raw of [{ flip: true }, { rotate: 1 }, { quality: 50 }, { format: "png" }, { filter: "grayscale" }]) {
      expect(isOk(create(raw))).toBe(true);
    }
  });

  it("le filigrane seul est une opération ; un filigrane invalide est propagé", () => {
    const valid = create({ watermark: { text: "Hello", position: "center", opacity: 0.8 } });
    expect(isOk(valid) && valid.value.watermark?.text).toBe("Hello");
    for (const watermark of [{ text: "" }, { text: "<b>" }, { text: "ok", position: "nulle part" }, { text: "ok", opacity: 2 }]) {
      const result = create({ watermark });
      expect(isErr(result) && result.error.kind).toBe("InvalidTransformation");
    }
  });

  it("propage le premier paramètre invalide", () => {
    for (const raw of [{ rotate: 999 }, { filter: "blur" }, { format: "gif" }, { quality: 0 }, { resize: { width: MAX + 1 } }, { crop: { x: -1, y: 0, width: 1, height: 1 } }]) {
      const result = create(raw);
      expect(isErr(result) && result.error.kind).toBe("InvalidTransformation");
    }
  });

  it("le format de sortie est celui demandé, sinon celui de la source", () => {
    const withFormat = create({ format: "webp" });
    const without = create({ flip: true });
    if (!isOk(withFormat) || !isOk(without)) throw new Error("jeux de test invalides");
    expect(withFormat.value.outputFormat(ImageFormat.JPEG)).toBe(ImageFormat.WEBP);
    expect(without.value.outputFormat(ImageFormat.JPEG)).toBe(ImageFormat.JPEG);
  });

  it("checkAgainst : crop hors de l'image refusé, crop pile aux bords accepté", () => {
    const outside = create({ crop: { x: 30, y: 0, width: 20, height: 10 } });
    const exact = create({ crop: { x: 20, y: 10, width: 20, height: 10 } });
    if (!isOk(outside) || !isOk(exact)) throw new Error("jeux de test invalides");
    const source = { dimensions: dims(40, 20), format: ImageFormat.PNG };
    expect(outside.value.checkAgainst(source)?.reason).toContain("crop dépasse");
    expect(exact.value.checkAgainst(source)).toBeNull();
  });

  it("checkAgainst : la qualité est refusée pour une sortie PNG, acceptée pour JPEG et WebP", () => {
    const quality = create({ quality: 80 });
    const toWebp = create({ quality: 80, format: "webp" });
    const toPng = create({ quality: 80, format: "png" });
    if (!isOk(quality) || !isOk(toWebp) || !isOk(toPng)) throw new Error("jeux de test invalides");
    const dimensions = dims(10, 10);
    expect(quality.value.checkAgainst({ dimensions, format: ImageFormat.PNG })?.reason).toContain("quality");
    expect(quality.value.checkAgainst({ dimensions, format: ImageFormat.JPEG })).toBeNull();
    expect(toWebp.value.checkAgainst({ dimensions, format: ImageFormat.PNG })).toBeNull();
    expect(toPng.value.checkAgainst({ dimensions, format: ImageFormat.JPEG })?.reason).toContain("quality");
  });
});
