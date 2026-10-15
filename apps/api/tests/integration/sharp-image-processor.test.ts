/** Tests d'intégration de SharpImageProcessor avec de vraies images. */
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { isErr, isOk } from "../../src/domain/shared/result.js";
import { SharpImageProcessor } from "../../src/infrastructure/image/sharp-image-processor.js";
import { makeImage } from "../helpers/images.js";

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
