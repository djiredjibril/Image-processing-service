/**
 * Value Object représentant une rotation d'image en degrés.
 *
 * Couche : domaine.
 */
import { InvalidTransformationError } from "../errors/image-errors.js";
import { err, ok, type Result } from "../shared/result.js";

const MAX_DEGREES = 360;

/**
 * Angle de rotation dans le sens horaire.
 *
 * Invariants : entier compris entre -360 et 360 (négatif = sens antihoraire). Une rotation
 * d'angle libre agrandit le canevas : les coins vides sont transparents (PNG, WebP) ou blancs (JPEG).
 */
export class Rotation {
  private constructor(public readonly degrees: number) {}

  /**
   * Construit une rotation valide.
   *
   * @param degrees - Angle en degrés.
   * @returns `Ok(Rotation)`, ou `Err(InvalidTransformationError)` si l'angle n'est pas un entier entre -360 et 360.
   */
  static create(degrees: number): Result<Rotation, InvalidTransformationError> {
    if (!Number.isInteger(degrees) || degrees < -MAX_DEGREES || degrees > MAX_DEGREES) {
      return err(new InvalidTransformationError(`rotate doit être un entier entre -${String(MAX_DEGREES)} et ${String(MAX_DEGREES)}`));
    }
    return ok(new Rotation(degrees));
  }

  /** `true` si la rotation ne change rien (0, 360 ou -360 degrés). */
  get isIdentity(): boolean {
    return this.degrees % 360 === 0;
  }
}
