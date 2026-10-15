/** Aides de test : fabrique de vraies images avec sharp. */
import sharp from "sharp";

/** Format d'image générable. */
export type TestFormat = "jpeg" | "png" | "webp";

/** Génère une image unie de la taille donnée, dans le format donné. */
export async function makeImage(format: TestFormat, width = 20, height = 10): Promise<Buffer> {
  const base = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } });
  return base[format]().toBuffer();
}

/** Pixel RGBA. */
export type Rgba = readonly [number, number, number, number];

/** Couleurs des quatre quadrants de `makeQuadrants`. */
export const RED: Rgba = [255, 0, 0, 255];
export const GREEN: Rgba = [0, 255, 0, 255];
export const BLUE: Rgba = [0, 0, 255, 255];
export const YELLOW: Rgba = [255, 255, 0, 255];

/**
 * PNG dont les quatre quadrants ont des couleurs distinctes (haut-gauche rouge, haut-droite vert,
 * bas-gauche bleu, bas-droite jaune) : permet de vérifier l'orientation exacte d'un résultat.
 */
export async function makeQuadrants(width = 40, height = 20): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const top = y < height / 2;
      const left = x < width / 2;
      const [r, g, b] = top ? (left ? RED : GREEN) : left ? BLUE : YELLOW;
      raw.set([r, g, b], (y * width + x) * 3);
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/** Lit le pixel (x, y) d'une image, quelle que soit sa colorimétrie, au format RGBA. */
export async function pixelAt(image: Uint8Array, x: number, y: number): Promise<Rgba> {
  const { data, info } = await sharp(image).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * 4;
  return [data[offset] ?? -1, data[offset + 1] ?? -1, data[offset + 2] ?? -1, data[offset + 3] ?? -1];
}

/** Compare deux couleurs avec une tolérance (utile pour les formats avec perte). */
export function isCloseTo(actual: Rgba, expected: Rgba, tolerance = 3): boolean {
  return actual.every((value, index) => Math.abs(value - (expected[index] ?? 0)) <= tolerance);
}
