/**
 * Value Object représentant un mot de passe DÉJÀ haché.
 *
 * Couche : domaine.
 */

/**
 * Empreinte d'un mot de passe (ex. chaîne `$argon2id$...`).
 *
 * Invariants : jamais vide ; ne sert qu'à stocker/comparer. Le type distingue un hash
 * d'une simple `string` pour qu'un mot de passe en clair ne soit jamais passé par erreur
 * là où un hash est attendu. Par sécurité, sa sérialisation (`toString`, `toJSON`) est
 * masquée : un hash ne fuit ni dans une réponse HTTP ni dans un log par inadvertance.
 */
export class PasswordHash {
  private constructor(private readonly hash: string) {}

  /**
   * Enveloppe un hash produit par un `IPasswordHasher` ou relu depuis la base.
   *
   * @param hash - Empreinte déjà calculée.
   * @returns Le value object.
   * @throws Si `hash` est vide : c'est un bug de l'appelant, pas une erreur métier.
   */
  static fromHash(hash: string): PasswordHash {
    if (hash.length === 0) {
      throw new Error("Un PasswordHash ne peut pas être vide");
    }
    return new PasswordHash(hash);
  }

  /**
   * Donne accès à la valeur brute, uniquement pour la persistance ou la vérification.
   *
   * @returns L'empreinte telle que stockée.
   */
  reveal(): string {
    return this.hash;
  }

  /**
   * Texte de substitution pour éviter toute fuite dans un log ou une interpolation.
   *
   * @returns Un texte masqué (jamais le hash).
   */
  toString(): string {
    return "[PasswordHash masqué]";
  }

  /**
   * Même masquage pour `JSON.stringify`.
   *
   * @returns Un texte masqué (jamais le hash).
   */
  toJSON(): string {
    return this.toString();
  }
}
