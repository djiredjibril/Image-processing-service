/**
 * Implémentation PostgreSQL (driver `pg`) de `IUserRepository`.
 *
 * Couche : infrastructure (persistance). SQL paramétré uniquement.
 */
import pg from "pg";
import { User } from "../../domain/entities/user.js";
import { EmailAlreadyUsedError } from "../../domain/errors/user-errors.js";
import type { IUserRepository } from "../../domain/repositories/user-repository.js";
import { err, isErr, ok, type Result } from "../../domain/shared/result.js";
import { Email } from "../../domain/value-objects/email.js";
import { PasswordHash } from "../../domain/value-objects/password-hash.js";

const UNIQUE_VIOLATION = "23505";
const EMAIL_UNIQUE_CONSTRAINT = "users_email_key";

interface UserRow {
  readonly id: string;
  readonly email: string;
  readonly password_hash: string;
  readonly created_at: Date;
}

/** Repository des utilisateurs adossé à PostgreSQL. */
export class PgUserRepository implements IUserRepository {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Insère l'utilisateur ; une violation de la contrainte UNIQUE sur l'e-mail est traduite
   * en `Err(EmailAlreadyUsedError)`. Toute autre erreur (panne) est relancée.
   */
  async save(user: User): Promise<Result<void, EmailAlreadyUsedError>> {
    try {
      await this.pool.query(
        "INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, $3, $4)",
        [user.id, user.email.value, user.passwordHash.reveal(), user.createdAt],
      );
      return ok(undefined);
    } catch (error) {
      if (error instanceof pg.DatabaseError && error.code === UNIQUE_VIOLATION && error.constraint === EMAIL_UNIQUE_CONSTRAINT) {
        return err(new EmailAlreadyUsedError());
      }
      throw error;
    }
  }

  /** Renvoie l'utilisateur ou `null` s'il n'existe pas. */
  async findByEmail(email: Email): Promise<User | null> {
    const result = await this.pool.query<UserRow>(
      "SELECT id, email, password_hash, created_at FROM users WHERE email = $1",
      [email.value],
    );
    const row = result.rows[0];
    return row === undefined ? null : toUser(row);
  }
}

/** Reconstruit l'entité ; un e-mail invalide en base signalerait des données corrompues (bug). */
function toUser(row: UserRow): User {
  const email = Email.create(row.email);
  if (isErr(email)) {
    throw new Error(`E-mail corrompu en base pour l'utilisateur ${row.id}`);
  }
  return User.restore({
    id: row.id,
    email: email.value,
    passwordHash: PasswordHash.fromHash(row.password_hash),
    createdAt: row.created_at,
  });
}
