/**
 * Port `IPasswordHasher` : hachage des mots de passe.
 *
 * Couche : domaine (port). L'algorithme concret (argon2) vit en infrastructure.
 */
import type { PasswordHash } from "../value-objects/password-hash.js";

/**
 * Contrat de hachage de mot de passe.
 *
 * Toute implémentation doit produire un hash salé (deux appels sur le même mot de passe
 * donnent deux hashs différents) et ne jamais conserver ni logger le mot de passe en clair.
 */
export interface IPasswordHasher {
  /**
   * Calcule l'empreinte d'un mot de passe.
   *
   * @param plain - Mot de passe en clair (déjà validé par l'appelant).
   * @returns L'empreinte à stocker. Ne lève pas d'erreur métier.
   */
  hash(plain: string): Promise<PasswordHash>;

  /**
   * Compare un mot de passe en clair à une empreinte stockée.
   *
   * @param plain - Mot de passe saisi.
   * @param hash - Empreinte stockée.
   * @returns `true` si le mot de passe correspond, `false` sinon. Ne lève pas d'erreur
   * pour un simple « ne correspond pas ».
   */
  verify(plain: string, hash: PasswordHash): Promise<boolean>;
}
