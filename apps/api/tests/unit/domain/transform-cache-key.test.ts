/** Tests unitaires de la clé de cache : demandes équivalentes → même clé, demandes différentes → clés différentes. */
import { describe, expect, it } from "vitest";
import { isOk } from "../../../src/domain/shared/result.js";
import { ImageFormat } from "../../../src/domain/value-objects/image-format.js";
import { TransformCacheKey } from "../../../src/domain/value-objects/transform-cache-key.js";
import { type RawTransformationInput, TransformationSet } from "../../../src/domain/value-objects/transformation-set.js";

function keyOf(raw: RawTransformationInput, options: { owner?: string; source?: string; source_format?: ImageFormat } = {}): string {
  const set = TransformationSet.create(raw, { maxSide: 8000 });
  if (!isOk(set)) throw new Error(`jeu de test invalide : ${set.error.reason}`);
  const outputFormat = set.value.outputFormat(options.source_format ?? ImageFormat.PNG);
  return TransformCacheKey.create({ ownerId: options.owner ?? "u1", sourceId: options.source ?? "s1", transformations: set.value, outputFormat }).value;
}

describe("TransformCacheKey", () => {
  it("est une empreinte SHA-256 : 64 caractères hexadécimaux, déterministe", () => {
    const key = keyOf({ rotate: 90 });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(keyOf({ rotate: 90 })).toBe(key);
  });

  describe("demandes équivalentes : MÊME clé", () => {
    it("opérations sans effet explicites ou omises (flip: false, mirror: false, rotate: 0)", () => {
      expect(keyOf({ rotate: 90, flip: false, mirror: false })).toBe(keyOf({ rotate: 90 }));
      expect(keyOf({ rotate: 90, rotate_unused: undefined } as RawTransformationInput)).toBe(keyOf({ rotate: 90 }));
      expect(keyOf({ flip: true, rotate: 0 })).toBe(keyOf({ flip: true }));
      expect(keyOf({ flip: true, rotate: 360 })).toBe(keyOf({ flip: true }));
    });

    it("rotations équivalentes : -90° et 270°, 450° n'existe pas mais -270° et 90° sont identiques", () => {
      expect(keyOf({ rotate: -90 })).toBe(keyOf({ rotate: 270 }));
      expect(keyOf({ rotate: -270 })).toBe(keyOf({ rotate: 90 }));
      expect(keyOf({ rotate: -180 })).toBe(keyOf({ rotate: 180 }));
    });

    it("valeurs par défaut explicites ou omises : fit « inside », position « bottom-right », opacité 0,5", () => {
      expect(keyOf({ resize: { width: 100, fit: "inside" } })).toBe(keyOf({ resize: { width: 100 } }));
      expect(keyOf({ watermark: { text: "x", position: "bottom-right", opacity: 0.5 } })).toBe(keyOf({ watermark: { text: "x" } }));
    });

    it("espaces autour du texte du filigrane ignorés", () => {
      expect(keyOf({ watermark: { text: "  Hello  " } })).toBe(keyOf({ watermark: { text: "Hello" } }));
    });

    it("format demandé identique au format de la source, ou omis", () => {
      expect(keyOf({ rotate: 90, format: "png" }, { source_format: ImageFormat.PNG })).toBe(keyOf({ rotate: 90 }, { source_format: ImageFormat.PNG }));
    });

    it("ordre des champs du JSON sans importance", () => {
      const a = keyOf({ rotate: 90, filter: "sepia", resize: { width: 10, height: 20, fit: "cover" } });
      const b = keyOf({ resize: { fit: "cover", height: 20, width: 10 }, filter: "sepia", rotate: 90 });
      expect(a).toBe(b);
    });
  });

  describe("demandes différentes : clés DIFFÉRENTES", () => {
    const base = { rotate: 90, resize: { width: 100 }, filter: "sepia", watermark: { text: "x" }, format: "webp", quality: 70 };
    const reference = keyOf(base);

    it.each([
      ["angle de rotation", { ...base, rotate: 180 }],
      ["largeur", { ...base, resize: { width: 101 } }],
      ["mode d'ajustement", { ...base, resize: { width: 100, fit: "cover" } }],
      ["filtre", { ...base, filter: "grayscale" }],
      ["texte du filigrane", { ...base, watermark: { text: "y" } }],
      ["position du filigrane", { ...base, watermark: { text: "x", position: "center" } }],
      ["opacité du filigrane", { ...base, watermark: { text: "x", opacity: 0.6 } }],
      ["format de sortie", { ...base, format: "jpeg" }],
      ["qualité", { ...base, quality: 71 }],
      ["miroir", { ...base, mirror: true }],
      ["retournement", { ...base, flip: true }],
      ["recadrage", { ...base, crop: { x: 0, y: 0, width: 10, height: 10 } }],
    ])("%s", (_name, raw) => {
      expect(keyOf(raw as RawTransformationInput)).not.toBe(reference);
    });

    it("l'image source, et l'utilisateur", () => {
      expect(keyOf(base, { source: "s2" })).not.toBe(reference);
      expect(keyOf(base, { owner: "u2" })).not.toBe(reference);
    });

    it("la position des valeurs compte : crop {x:1,y:2} n'est pas crop {x:2,y:1}", () => {
      const a = keyOf({ crop: { x: 1, y: 2, width: 5, height: 5 } });
      const b = keyOf({ crop: { x: 2, y: 1, width: 5, height: 5 } });
      expect(a).not.toBe(b);
    });

    it("largeur seule et hauteur seule ne se confondent pas", () => {
      expect(keyOf({ resize: { width: 100 } })).not.toBe(keyOf({ resize: { height: 100 } }));
    });
  });
});
