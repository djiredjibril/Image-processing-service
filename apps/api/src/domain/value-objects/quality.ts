/**
 * Value Object représentant la qualité (compression) d'une image de sortie.
 *
 * Couche : domaine.
 */
import { InvalidTransformationError } from "../errors/image-errors.js";
import { err, ok, type Result } from "../shared/result.js";

/**
 * Qualité de compression : plus elle est basse, plus le fichier est léger et dégradé.
 *
 * Invariants : entier compris entre 1 et 100. S'applique aux formats avec perte (JPEG, WebP) ;
 * le PNG est sans perte, la qualité n'y a pas de sens.
 */
export class Quality {
  private constructor(public readonly value: number) {}

  /**
   * Construit une qualité valide.
   *
   * @param value - Qualité de 1 à 100.
   * @returns `Ok(Quality)`, ou `Err(InvalidTransformationError)` si ce n'est pas un entier entre 1 et 100.
   */
  static create(value: number): Result<Quality, InvalidTransformationError> {
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      return err(new InvalidTransformationError("quality doit être un entier entre 1 et 100"));
    }
    return ok(new Quality(value));
  }
}
