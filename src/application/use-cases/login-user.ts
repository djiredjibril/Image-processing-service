/**
 * Use case `LoginUser` : authentifier un utilisateur et émettre un jeton.
 *
 * Couche : application.
 */
import { InvalidCredentialsError } from "../../domain/errors/user-errors.js";
import type { IPasswordHasher } from "../../domain/ports/password-hasher.js";
import type { ITokenService } from "../../domain/ports/token-service.js";
import type { IUserRepository } from "../../domain/repositories/user-repository.js";
import { Email } from "../../domain/value-objects/email.js";
import type { PasswordHash } from "../../domain/value-objects/password-hash.js";
import { err, isErr, ok, type Result } from "../shared/result.js";

/** Données d'entrée brutes. */
export interface LoginUserInput {
  readonly email: string;
  readonly password: string;
}

/** Résultat d'une connexion réussie. */
export interface LoginUserOutput {
  readonly token: string;
}

/**
 * Connecte un utilisateur.
 *
 * Anti-énumération : une seule erreur (`InvalidCredentialsError`) pour e-mail mal formé,
 * e-mail inconnu et mauvais mot de passe. Anti-timing : quand l'e-mail est inconnu, on
 * fait quand même une vérification de mot de passe contre un faux hash, pour que la
 * réponse ne soit pas nettement plus rapide que pour un compte existant.
 */
export class LoginUser {
  private dummyHash: Promise<PasswordHash> | undefined;

  constructor(
    private readonly users: IUserRepository,
    private readonly hasher: IPasswordHasher,
    private readonly tokens: ITokenService,
  ) {}

  /**
   * Exécute la connexion.
   *
   * @param input - E-mail et mot de passe en clair.
   * @returns `Ok({ token })`, ou `Err(InvalidCredentialsError)` dans tous les cas d'échec.
   */
  async execute(input: LoginUserInput): Promise<Result<LoginUserOutput, InvalidCredentialsError>> {
    const email = Email.create(input.email);
    const user = isErr(email) ? null : await this.users.findByEmail(email.value);

    if (user === null) {
      await this.hasher.verify(input.password, await this.getDummyHash());
      return err(new InvalidCredentialsError());
    }
    if (!(await this.hasher.verify(input.password, user.passwordHash))) {
      return err(new InvalidCredentialsError());
    }
    return ok({ token: await this.tokens.sign({ userId: user.id }) });
  }

  /** Calcule une seule fois un hash factice, au coût identique à un vrai hash. */
  private getDummyHash(): Promise<PasswordHash> {
    this.dummyHash ??= this.hasher.hash("mot-de-passe-factice");
    return this.dummyHash;
  }
}
