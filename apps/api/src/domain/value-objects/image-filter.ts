/**
 * Value Object représentant un filtre de couleur.
 *
 * Couche : domaine.
 */
import { InvalidTransformationError } from "../errors/image-errors.js";
import { err, ok, type Result } from "../shared/result.js";

/** Filtres disponibles. */
export const IMAGE_FILTERS = ["grayscale", "sepia"] as const;

/** Nom d'un filtre : niveaux de gris ou sépia. */
export type ImageFilterName = (typeof IMAGE_FILTERS)[number];

/**
 * Filtre de couleur à appliquer.
 *
 * Invariants : seules les valeurs de `IMAGE_FILTERS` existent.
 */
export class ImageFilter {
  private constructor(public readonly name: ImageFilterName) {}

  /**
   * Construit un filtre à partir de son nom.
   *
   * @param raw - Nom demandé.
   * @returns `Ok(ImageFilter)`, ou `Err(InvalidTransformationError)` si le nom est inconnu.
   */
  static create(raw: string): Result<ImageFilter, InvalidTransformationError> {
    const name = IMAGE_FILTERS.find((candidate) => candidate === raw);
    if (name === undefined) {
      return err(new InvalidTransformationError(`filter doit valoir : ${IMAGE_FILTERS.join(", ")}`));
    }
    return ok(new ImageFilter(name));
  }
}
