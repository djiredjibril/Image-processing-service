/** Aide de test : assemble l'app Express complète avec les vraies implémentations. */
import type { Express } from "express";
import type pg from "pg";
import { LoginUser } from "../../src/application/use-cases/login-user.js";
import { RegisterUser } from "../../src/application/use-cases/register-user.js";
import { createApp } from "../../src/infrastructure/http/app.js";
import { PgUserRepository } from "../../src/infrastructure/persistence/pg-user-repository.js";
import { JwtTokenService } from "../../src/infrastructure/security/jwt-token-service.js";
import { Argon2PasswordHasher } from "../../src/infrastructure/security/argon2-password-hasher.js";

/** Secret de signature utilisé uniquement dans les tests. */
export const TEST_JWT_SECRET = "test-secret-test-secret-test-secret-1234";

/** Construit l'application avec la base de test fournie. */
export function buildTestApp(pool: pg.Pool): Express {
  const users = new PgUserRepository(pool);
  const hasher = new Argon2PasswordHasher();
  const tokens = new JwtTokenService(TEST_JWT_SECRET, "1h");
  return createApp({ pool, registerUser: new RegisterUser(users, hasher), loginUser: new LoginUser(users, hasher, tokens) });
}
