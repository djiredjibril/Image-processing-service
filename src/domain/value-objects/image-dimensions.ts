/**
 * Value Object représentant les dimensions d'une image.
 *
 * Couche : domaine.
 */
import { CorruptedImageError } from "../errors/image-errors.js";
import { err, ok, type Result } from "../shared/result.js";

/**
 * Largeur et hauteur en pixels.
 *
 * Invariants : deux entiers strictement positifs.
 */
export class ImageDimensions {
  private constructor(
    public readonly width: number,
    public readonly height: number,
  ) {}

  /**
   * Construit des dimensions valides.
   *
   * @param width - Largeur en pixels.
   * @param height - Hauteur en pixels.
   * @returns `Ok(ImageDimensions)`, ou `Err(CorruptedImageError)` si une valeur n'est pas un entier positif.
   */
  static create(width: number, height: number): Result<ImageDimensions, CorruptedImageError> {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      return err(new CorruptedImageError("dimensions invalides"));
    }
    return ok(new ImageDimensions(width, height));
  }

  /**
   * Indique si l'un des côtés dépasse une limite.
   *
   * @param maxSide - Taille maximale autorisée par côté, en pixels.
   * @returns `true` si la largeur ou la hauteur dépasse `maxSide`.
   */
  exceeds(maxSide: number): boolean {
    return this.width > maxSide || this.height > maxSide;
  }
}
