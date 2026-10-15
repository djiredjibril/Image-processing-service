/** Tests unitaires des value objects d'image (format, dimensions, poids, clé de stockage). */
import { describe, expect, it } from "vitest";
import { isErr, isOk } from "../../../src/domain/shared/result.js";
import { FileSize } from "../../../src/domain/value-objects/file-size.js";
import { ImageDimensions } from "../../../src/domain/value-objects/image-dimensions.js";
import { ImageFormat } from "../../../src/domain/value-objects/image-format.js";
import { StorageKey } from "../../../src/domain/value-objects/storage-key.js";

describe("ImageFormat.fromMagicBytes", () => {
  it("reconnaît JPEG, PNG et WebP par leur signature", () => {
    expect(ImageFormat.fromMagicBytes(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe(ImageFormat.JPEG);
    expect(ImageFormat.fromMagicBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(ImageFormat.PNG);
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WEBPVP8 ")]);
    expect(ImageFormat.fromMagicBytes(webp)).toBe(ImageFormat.WEBP);
  });

  it("refuse GIF, texte, RIFF non WebP, et contenu vide ou trop court", () => {
    expect(ImageFormat.fromMagicBytes(Buffer.from("GIF89a..."))).toBeNull();
    expect(ImageFormat.fromMagicBytes(Buffer.from("je suis un faux.jpg"))).toBeNull();
    expect(ImageFormat.fromMagicBytes(Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WAVEfmt ")]))).toBeNull();
    expect(ImageFormat.fromMagicBytes(new Uint8Array())).toBeNull();
    expect(ImageFormat.fromMagicBytes(Uint8Array.from([0xff, 0xd8]))).toBeNull();
  });

  it("expose extension et type MIME, et se retrouve par nom", () => {
    expect(ImageFormat.JPEG.extension).toBe("jpg");
    expect(ImageFormat.PNG.mimeType).toBe("image/png");
    expect(ImageFormat.fromName("webp")).toBe(ImageFormat.WEBP);
    expect(ImageFormat.fromName("gif")).toBeNull();
  });
});

describe("ImageDimensions", () => {
  it("accepte des entiers positifs et refuse le reste", () => {
    expect(isOk(ImageDimensions.create(10, 5))).toBe(true);
    for (const [w, h] of [[0, 5], [5, -1], [1.5, 2], [Number.NaN, 2]] as const) {
      expect(isErr(ImageDimensions.create(w, h))).toBe(true);
    }
  });

  it("exceeds() teste chaque côté, limite incluse", () => {
    const dims = ImageDimensions.create(8000, 100);
    if (!isOk(dims)) throw new Error("dimensions de test invalides");
    expect(dims.value.exceeds(8000)).toBe(false);
    expect(dims.value.exceeds(7999)).toBe(true);
  });
});

describe("FileSize", () => {
  it("refuse 0 et les valeurs non entières, accepte un poids positif", () => {
    expect(isErr(FileSize.create(0))).toBe(true);
    expect(isErr(FileSize.create(1.5))).toBe(true);
    expect(isOk(FileSize.create(1))).toBe(true);
  });

  it("exceeds() : strictement supérieur à la limite", () => {
    const size = FileSize.create(10);
    if (!isOk(size)) throw new Error("poids de test invalide");
    expect(size.value.exceeds(10)).toBe(false);
    expect(size.value.exceeds(9)).toBe(true);
  });
});

describe("StorageKey", () => {
  it("forOriginal génère originals/<uuid>.<ext>, unique à chaque appel", () => {
    const a = StorageKey.forOriginal(ImageFormat.JPEG);
    const b = StorageKey.forOriginal(ImageFormat.JPEG);
    expect(a.value).toMatch(/^originals\/[0-9a-f-]{36}\.jpg$/);
    expect(a.value).not.toBe(b.value);
  });

  it("restore refuse les clés dangereuses", () => {
    for (const bad of ["../secret.jpg", "/etc/passwd", "originals/../x.jpg", "a\\b.jpg", "sans-extension", ""]) {
      expect(() => StorageKey.restore(bad)).toThrow();
    }
    expect(StorageKey.restore("originals/abc-123.png").value).toBe("originals/abc-123.png");
  });
});
