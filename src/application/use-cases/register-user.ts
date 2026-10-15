/**
 * Use case `RegisterUser` : créer un compte utilisateur.
 *
 * Couche : application.
 */
import { User } from "../../domain/entities/user.js";
import { EmailAlreadyUsedError, type InvalidEmailError, WeakPasswordError } from "../../domain/errors/user-errors.js";
import type { IPasswordHasher } from "../../domain/ports/password-hasher.js";
import type { IUserRepository } from "../../domain/repositories/user-repository.js";
import { Email } from "../../domain/value-objects/email.js";
import { err, isErr, ok, type Result } from "../shared/result.js";

/** Longueur minimale d'un mot de passe. */
export const MIN_PASSWORD_LENGTH = 8;

/** Données d'entrée brutes (déjà typées `string` par la validation HTTP). */
export interface RegisterUserInput {
  readonly email: string;
  readonly password: string;
}

/** Données publiques d'un compte créé : jamais le hash. */
export interface RegisterUserOutput {
  readonly id: string;
  readonly email: string;
}

/** Erreurs métier possibles de `RegisterUser`. */
export type RegisterUserError = InvalidEmailError | WeakPasswordError | EmailAlreadyUsedError;

/**
 * Inscrit un nouvel utilisateur.
 *
 * Ordre voulu : valider l'e-mail, valider le mot de passe AVANT tout hachage (le hachage
 * est volontairement coûteux : inutile de le payer pour une entrée invalide), vérifier
 * l'unicité, hacher, puis enregistrer.
 */
export class RegisterUser {
  constructor(
    private readonly users: IUserRepository,
    private readonly hasher: IPasswordHasher,
  ) {}

  /**
   * Exécute l'inscription.
   *
   * @param input - E-mail et mot de passe en clair.
   * @returns `Ok({ id, email })`, ou `Err` parmi : `InvalidEmailError`,
   * `WeakPasswordError`, `EmailAlreadyUsedError`.
   */
  async execute(input: RegisterUserInput): Promise<Result<RegisterUserOutput, RegisterUserError>> {
    const email = Email.create(input.email);
    if (isErr(email)) {
      return err(email.error);
    }
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      return err(new WeakPasswordError(`minimum ${String(MIN_PASSWORD_LENGTH)} caractères`));
    }
    if ((await this.users.findByEmail(email.value)) !== null) {
      return err(new EmailAlreadyUsedError());
    }

    const passwordHash = await this.hasher.hash(input.password);
    const user = User.create({ email: email.value, passwordHash });

    // Deux inscriptions simultanées peuvent passer le test ci-dessus : l'unicité réelle
    // est garantie par le repository (contrainte UNIQUE), qui renvoie la même erreur.
    const saved = await this.users.save(user);
    if (isErr(saved)) {
      return err(saved.error);
    }
    return ok({ id: user.id, email: user.email.value });
  }
}
