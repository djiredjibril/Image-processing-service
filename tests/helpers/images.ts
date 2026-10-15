/** Aides de test : fabrique de vraies images avec sharp. */
import sharp from "sharp";

/** Format d'image générable. */
export type TestFormat = "jpeg" | "png" | "webp";

/** Génère une image unie de la taille donnée, dans le format donné. */
export async function makeImage(format: TestFormat, width = 20, height = 10): Promise<Buffer> {
  const base = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } });
  return base[format]().toBuffer();
}
