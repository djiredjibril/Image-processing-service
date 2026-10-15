/**
 * Implémentation `IImageProcessor` avec la bibliothèque `sharp`.
 *
 * Couche : infrastructure (image). Seul endroit qui importe `sharp`.
 */
import sharp from "sharp";
import { CorruptedImageError } from "../../domain/errors/image-errors.js";
import type { IImageProcessor, ImageMetadata } from "../../domain/ports/image-processor.js";
import { err, ok, type Result } from "../../domain/shared/result.js";

/** Lecture des métadonnées d'image via `sharp`. */
export class SharpImageProcessor implements IImageProcessor {
  /**
   * Lit format et dimensions depuis l'en-tête uniquement : `metadata()` ne décode pas les
   * pixels. Les dimensions sont celles APRÈS application de l'orientation EXIF (une photo
   * de téléphone « couchée » a sa largeur et sa hauteur inversées).
   */
  async readMetadata(data: Uint8Array): Promise<Result<ImageMetadata, CorruptedImageError>> {
    try {
      const metadata = await sharp(data).metadata();
      const width = metadata.autoOrient.width;
      const height = metadata.autoOrient.height;
      return ok({ format: metadata.format, width, height });
    } catch {
      return err(new CorruptedImageError("image illisible"));
    }
  }
}
