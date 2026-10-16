/**
 * Value Object représentant le poids d'un fichier.
 *
 * Couche : domaine.
 */
import { EmptyFileError } from "../errors/image-errors.js";
import { err, ok, type Result } from "../shared/result.js";

/**
 * Poids en octets.
 *
 * Invariants : entier strictement positif (un fichier vide n'est pas une image).
 */
export class FileSize {
  private constructor(public readonly bytes: number) {}

  /**
   * Construit un poids valide.
   *
   * @param bytes - Nombre d'octets.
   * @returns `Ok(FileSize)`, ou `Err(EmptyFileError)` si la valeur n'est pas un entier positif.
   */
  static create(bytes: number): Result<FileSize, EmptyFileError> {
    if (!Number.isInteger(bytes) || bytes <= 0) {
      return err(new EmptyFileError());
    }
    return ok(new FileSize(bytes));
  }

  /**
   * Indique si ce poids dépasse une limite.
   *
   * @param maxBytes - Poids maximal autorisé en octets.
   * @returns `true` si strictement supérieur à `maxBytes`.
   */
  exceeds(maxBytes: number): boolean {
    return this.bytes > maxBytes;
  }
}
