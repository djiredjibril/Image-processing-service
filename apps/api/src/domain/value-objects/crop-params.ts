/**
 * Value Object représentant une zone de recadrage.
 *
 * Couche : domaine.
 */
import { InvalidTransformationError } from "../errors/image-errors.js";
import { err, ok, type Result } from "../shared/result.js";
import type { ImageDimensions } from "./image-dimensions.js";

/** Zone de recadrage telle que reçue (valeurs non vérifiées). */
export interface RawCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Rectangle à conserver, exprimé en pixels dans l'image SOURCE (après orientation EXIF).
 *
 * Invariants : `x` et `y` sont des entiers >= 0 ; `width` et `height` des entiers >= 1.
 * Le fait que le rectangle tienne dans l'image dépend de l'image : voir `fitsWithin`.
 */
export class CropParams {
  private constructor(
    public readonly x: number,
    public readonly y: number,
    public readonly width: number,
    public readonly height: number,
  ) {}

  /**
   * Construit une zone de recadrage valide.
   *
   * @param raw - Origine (`x`, `y`) et taille (`width`, `height`).
   * @returns `Ok(CropParams)`, ou `Err(InvalidTransformationError)` si une valeur n'est pas un entier dans ses bornes.
   */
  static create(raw: RawCrop): Result<CropParams, InvalidTransformationError> {
    const originOk = Number.isInteger(raw.x) && Number.isInteger(raw.y) && raw.x >= 0 && raw.y >= 0;
    const sizeOk = Number.isInteger(raw.width) && Number.isInteger(raw.height) && raw.width >= 1 && raw.height >= 1;
    if (!originOk || !sizeOk) {
      return err(new InvalidTransformationError("crop : x et y doivent être des entiers >= 0, width et height des entiers >= 1"));
    }
    return ok(new CropParams(raw.x, raw.y, raw.width, raw.height));
  }

  /**
   * Indique si le rectangle tient entièrement dans l'image.
   *
   * @param source - Dimensions de l'image source.
   * @returns `true` si `x + width` et `y + height` ne dépassent pas l'image.
   */
  fitsWithin(source: ImageDimensions): boolean {
    return this.x + this.width <= source.width && this.y + this.height <= source.height;
  }
}
