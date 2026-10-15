/**
 * Implémentation argon2id de `IPasswordHasher`.
 *
 * Couche : infrastructure (sécurité).
 */
import argon2 from "argon2";
import type { IPasswordHasher } from "../../domain/ports/password-hasher.js";
import { PasswordHash } from "../../domain/value-objects/password-hash.js";

/**
 * Hachage avec argon2id et les paramètres par défaut de la bibliothèque (sel aléatoire
 * généré à chaque appel, intégré dans la chaîne produite).
 */
export class Argon2PasswordHasher implements IPasswordHasher {
  /** Calcule l'empreinte argon2id du mot de passe. */
  async hash(plain: string): Promise<PasswordHash> {
    return PasswordHash.fromHash(await argon2.hash(plain, { type: argon2.argon2id }));
  }
}
