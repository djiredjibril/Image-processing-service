/** Aide de test : assemble l'app Express complète avec les vraies implémentations. */
import type { Express } from "express";
import type pg from "pg";
import { RegisterUser } from "../../src/application/use-cases/register-user.js";
import { createApp } from "../../src/infrastructure/http/app.js";
import { PgUserRepository } from "../../src/infrastructure/persistence/pg-user-repository.js";
import { Argon2PasswordHasher } from "../../src/infrastructure/security/argon2-password-hasher.js";

/** Construit l'application avec la base de test fournie. */
export function buildTestApp(pool: pg.Pool): Express {
  const registerUser = new RegisterUser(new PgUserRepository(pool), new Argon2PasswordHasher());
  return createApp({ pool, registerUser });
}
