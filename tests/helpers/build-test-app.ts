/** Aide de test : assemble l'app Express complète avec les vraies implémentations. */
import type { Express } from "express";
import type pg from "pg";
import { LoginUser } from "../../src/application/use-cases/login-user.js";
import { RegisterUser } from "../../src/application/use-cases/register-user.js";
import { UploadImage } from "../../src/application/use-cases/upload-image.js";
import { createApp } from "../../src/infrastructure/http/app.js";
import { SharpImageProcessor } from "../../src/infrastructure/image/sharp-image-processor.js";
import { PgImageRepository } from "../../src/infrastructure/persistence/pg-image-repository.js";
import { PgUserRepository } from "../../src/infrastructure/persistence/pg-user-repository.js";
import { JwtTokenService } from "../../src/infrastructure/security/jwt-token-service.js";
import { Argon2PasswordHasher } from "../../src/infrastructure/security/argon2-password-hasher.js";
import { LocalFileStorage } from "../../src/infrastructure/storage/local-file-storage.js";

/** Secret de signature utilisé uniquement dans les tests. */
export const TEST_JWT_SECRET = "test-secret-test-secret-test-secret-1234";

/** Options de l'application de test. */
export interface TestAppOptions {
  /** Dossier de stockage (un dossier temporaire par fichier de test). */
  readonly storageDir?: string;
  readonly maxUploadBytes?: number;
  readonly maxPixelsSide?: number;
}

/** Construit l'application avec la base de test fournie (limites par défaut : 10 Mo, 8000 px). */
export function buildTestApp(pool: pg.Pool, options: TestAppOptions = {}): Express {
  const maxUploadBytes = options.maxUploadBytes ?? 10_485_760;
  const users = new PgUserRepository(pool);
  const hasher = new Argon2PasswordHasher();
  const tokens = new JwtTokenService(TEST_JWT_SECRET, "1h");
  const uploadImage = new UploadImage(
    new LocalFileStorage(options.storageDir ?? "storage-test"),
    new SharpImageProcessor(),
    new PgImageRepository(pool),
    { maxBytes: maxUploadBytes, maxPixelsSide: options.maxPixelsSide ?? 8000 },
  );
  return createApp({
    pool,
    registerUser: new RegisterUser(users, hasher),
    loginUser: new LoginUser(users, hasher, tokens),
    uploadImage,
    tokens,
    maxUploadBytes,
  });
}
