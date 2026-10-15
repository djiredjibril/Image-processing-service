/**
 * Implémentation `IImageProcessor` avec la bibliothèque `sharp`.
 *
 * Couche : infrastructure (image). Seul endroit qui importe `sharp`.
 */
import sharp from "sharp";
import { CorruptedImageError } from "../../domain/errors/image-errors.js";
import type { IImageProcessor, ImageMetadata, TransformedImage } from "../../domain/ports/image-processor.js";
import { err, ok, type Result } from "../../domain/shared/result.js";
import { ImageFormat } from "../../domain/value-objects/image-format.js";
import type { TransformationSet } from "../../domain/value-objects/transformation-set.js";

// Matrice classique du sépia : chaque canal de sortie est un mélange des canaux d'entrée.
const SEPIA_MATRIX: [[number, number, number], [number, number, number], [number, number, number]] = [
  [0.393, 0.769, 0.189],
  [0.349, 0.686, 0.168],
  [0.272, 0.534, 0.131],
];
const TRANSPARENT = { r: 255, g: 255, b: 255, alpha: 0 };
const OPAQUE_WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

/** Options du processeur. */
export interface SharpImageProcessorOptions {
  /** Nombre maximal de pixels décodés par image (protection contre les « decompression bombs »). */
  readonly limitInputPixels?: number;
}

/** Lecture et transformation d'images via `sharp`. */
export class SharpImageProcessor implements IImageProcessor {
  private readonly limitInputPixels: number | false;

  /**
   * Configure les limites de décodage.
   *
   * @param options - Limite de pixels ; sans valeur, on garde celle par défaut de `sharp`.
   */
  constructor(options: SharpImageProcessorOptions = {}) {
    this.limitInputPixels = options.limitInputPixels ?? 268_402_689;
  }

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

  /**
   * Applique le pipeline dans l'ordre : orientation EXIF → crop → rotate → flip → mirror → resize →
   * filtre → encodage. L'ordre est celui des appels : avec `sharp`, il change le résultat
   * (ex. extraire avant ou après une rotation). `sharp` retire les métadonnées (EXIF, GPS) de la
   * sortie tant qu'on ne demande pas explicitement de les conserver : on ne le demande jamais.
   */
  async transform(data: Uint8Array, transformations: TransformationSet, outputFormat: ImageFormat): Promise<Result<TransformedImage, CorruptedImageError>> {
    try {
      // Les zones vides créées par la rotation ou les marges d'un resize prennent ce fond. Le JPEG n'a pas de
      // transparence ET `sharp` n'aplatit pas après avoir agrandi le canevas : le fond doit être blanc dès le départ.
      const background = outputFormat === ImageFormat.JPEG ? OPAQUE_WHITE : TRANSPARENT;
      let image = sharp(data, { limitInputPixels: this.limitInputPixels }).autoOrient();

      if (transformations.crop !== null) {
        const { x, y, width, height } = transformations.crop;
        image = image.extract({ left: x, top: y, width, height });
      }
      if (transformations.rotation !== null && !transformations.rotation.isIdentity) {
        image = image.rotate(transformations.rotation.degrees, { background });
      }
      if (transformations.flip) {
        image = image.flip();
      }
      if (transformations.mirror) {
        image = image.flop();
      }
      if (transformations.resize !== null) {
        const { width, height, fit } = transformations.resize;
        image = image.resize({ width: width ?? undefined, height: height ?? undefined, fit, background });
      }
      if (transformations.filter?.name === "grayscale") {
        image = image.grayscale();
      } else if (transformations.filter?.name === "sepia") {
        image = image.recomb(SEPIA_MATRIX);
      }

      const quality = transformations.quality?.value;
      if (outputFormat === ImageFormat.JPEG) {
        // Une source PNG/WebP transparente est aplatie sur du blanc (le JPEG n'a pas d'alpha).
        image = image.flatten({ background: OPAQUE_WHITE }).jpeg({ quality });
      } else if (outputFormat === ImageFormat.WEBP) {
        image = image.webp({ quality });
      } else {
        image = image.png();
      }

      const { data: output, info } = await image.toBuffer({ resolveWithObject: true });
      const format = ImageFormat.fromName(info.format);
      return format === null ? err(new CorruptedImageError("format de sortie inattendu")) : ok({ data: output, format, width: info.width, height: info.height });
    } catch {
      return err(new CorruptedImageError("image illisible ou transformation impossible"));
    }
  }
}
