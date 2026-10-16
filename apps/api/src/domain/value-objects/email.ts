/**
 * Value Object représentant une adresse e-mail valide.
 *
 * Couche : domaine.
 */
import { InvalidEmailError } from "../errors/user-errors.js";
import { err, ok, type Result } from "../shared/result.js";

const MAX_EMAIL_LENGTH = 254;
// Volontairement simple : on vérifie « quelque chose@quelque.chose » sans prétendre
// implémenter la RFC 5322. Seul l'envoi d'un e-mail prouverait qu'une adresse existe.
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Adresse e-mail normalisée.
 *
 * Invariants : un `Email` existant est toujours bien formé, sans espace autour, en
 * minuscules et d'au plus 254 caractères. Aucun autre code n'a besoin de le revérifier.
 */
export class Email {
  private constructor(public readonly value: string) {}

  /**
   * Construit un Email à partir d'une chaîne brute.
   *
   * @param raw - Chaîne saisie par l'utilisateur (nettoyée puis mise en minuscules).
   * @returns `Ok(Email)` si le format est valide, sinon `Err(InvalidEmailError)`.
   * @example
   * const result = Email.create("  Salut@Example.com ");
   * // result.value.value === "salut@example.com"
   */
  static create(raw: string): Result<Email, InvalidEmailError> {
    const normalized = raw.trim().toLowerCase();
    if (normalized.length > MAX_EMAIL_LENGTH) {
      return err(new InvalidEmailError(`longueur maximale : ${String(MAX_EMAIL_LENGTH)} caractères`));
    }
    if (!EMAIL_FORMAT.test(normalized)) {
      return err(new InvalidEmailError("format invalide"));
    }
    return ok(new Email(normalized));
  }
}
