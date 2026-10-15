/**
 * Port `IUserRepository` : persistance des utilisateurs.
 *
 * Couche : domaine (port). Implémentations : `PgUserRepository` (prod), fake en mémoire (tests).
 */
import type { User } from "../entities/user.js";
import type { EmailAlreadyUsedError } from "../errors/user-errors.js";
import type { Result } from "../shared/result.js";
import type { Email } from "../value-objects/email.js";

/**
 * Contrat de persistance des utilisateurs.
 *
 * Toute implémentation garantit l'unicité de l'e-mail, même en cas d'écritures concurrentes.
 */
export interface IUserRepository {
  /**
   * Enregistre un nouvel utilisateur.
   *
   * @returns `Ok(undefined)` si enregistré, `Err(EmailAlreadyUsedError)` si l'e-mail existe
   * déjà (y compris quand deux inscriptions concurrentes passent la vérification préalable).
   */
  save(user: User): Promise<Result<void, EmailAlreadyUsedError>>;

  /**
   * Cherche un utilisateur par e-mail.
   *
   * @returns L'utilisateur, ou `null` s'il n'existe pas. Ne lève pas d'erreur pour « introuvable ».
   */
  findByEmail(email: Email): Promise<User | null>;
}
