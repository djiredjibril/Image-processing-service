/**
 * Entité `User` : un compte utilisateur.
 *
 * Couche : domaine.
 */
import { randomUUID } from "node:crypto";
import type { Email } from "../value-objects/email.js";
import type { PasswordHash } from "../value-objects/password-hash.js";

/** Données complètes d'un utilisateur (utilisées pour reconstruire depuis la base). */
export interface UserProps {
  readonly id: string;
  readonly email: Email;
  readonly passwordHash: PasswordHash;
  readonly createdAt: Date;
}

/**
 * Utilisateur du service.
 *
 * Invariants : immuable (toutes les propriétés `readonly`) ; l'e-mail est un `Email`
 * valide et le mot de passe n'existe que sous forme de `PasswordHash`. Aucun mot de
 * passe en clair n'est jamais porté par l'entité.
 */
export class User {
  private constructor(
    public readonly id: string,
    public readonly email: Email,
    public readonly passwordHash: PasswordHash,
    public readonly createdAt: Date,
  ) {}

  /**
   * Crée un nouvel utilisateur (identifiant et date générés ici).
   *
   * @param params - E-mail validé et mot de passe déjà haché.
   * @returns Un nouvel `User`.
   */
  static create(params: { readonly email: Email; readonly passwordHash: PasswordHash }): User {
    return new User(randomUUID(), params.email, params.passwordHash, new Date());
  }

  /**
   * Reconstruit un utilisateur existant (ex. lu en base) sans rien générer.
   *
   * @param props - Données déjà validées et persistées.
   * @returns L'`User` correspondant.
   */
  static restore(props: UserProps): User {
    return new User(props.id, props.email, props.passwordHash, props.createdAt);
  }
}
