/**
 * Composition root : seul endroit qui assemble les dépendances concrètes.
 *
 * Couche : point d'entrée. L'application refuse de démarrer si la config est invalide.
 */
import "dotenv/config";
import { isErr } from "./application/shared/result.js";
import { loadConfig } from "./infrastructure/config/config.js";
import { GetImage } from "./application/use-cases/get-image.js";
import { ListImages } from "./application/use-cases/list-images.js";
import { LoginUser } from "./application/use-cases/login-user.js";
import { RegisterUser } from "./application/use-cases/register-user.js";
import { TransformImage } from "./application/use-cases/transform-image.js";
import { UploadImage } from "./application/use-cases/upload-image.js";
import { createApp } from "./infrastructure/http/app.js";
import { SharpImageProcessor } from "./infrastructure/image/sharp-image-processor.js";
import { createPool } from "./infrastructure/persistence/database.js";
import { PgImageRepository } from "./infrastructure/persistence/pg-image-repository.js";
import { PgUserRepository } from "./infrastructure/persistence/pg-user-repository.js";
import { LocalFileStorage } from "./infrastructure/storage/local-file-storage.js";
import { JwtTokenService } from "./infrastructure/security/jwt-token-service.js";
import { Argon2PasswordHasher } from "./infrastructure/security/argon2-password-hasher.js";

const config = loadConfig(process.env);
if (isErr(config)) {
  console.error("Configuration invalide :\n" + config.error.map((line) => ` - ${line}`).join("\n"));
  process.exit(1);
}

const pool = createPool(config.value.DATABASE_URL);
const users = new PgUserRepository(pool);
const hasher = new Argon2PasswordHasher();
const tokens = new JwtTokenService(config.value.JWT_SECRET, config.value.JWT_EXPIRES_IN);
const storage = new LocalFileStorage(config.value.STORAGE_LOCAL_DIR);
const images = new PgImageRepository(pool);
// Un côté de 8000 px => au plus 8000 x 8000 pixels décodés : borne la mémoire d'un traitement.
const processor = new SharpImageProcessor({ limitInputPixels: config.value.MAX_IMAGE_PIXELS_SIDE ** 2 });
const uploadImage = new UploadImage(
  storage,
  processor,
  images,
  { maxBytes: config.value.MAX_UPLOAD_BYTES, maxPixelsSide: config.value.MAX_IMAGE_PIXELS_SIDE },
);
const app = createApp({
  pool,
  registerUser: new RegisterUser(users, hasher),
  loginUser: new LoginUser(users, hasher, tokens),
  uploadImage,
  getImage: new GetImage(images, storage),
  listImages: new ListImages(images),
  transformImage: new TransformImage(images, storage, processor, { maxPixelsSide: config.value.MAX_IMAGE_PIXELS_SIDE }),
  tokens,
  maxUploadBytes: config.value.MAX_UPLOAD_BYTES,
  corsOrigin: config.value.CORS_ORIGIN,
});

const server = app.listen(config.value.PORT, () => {
  console.log(`Serveur démarré sur le port ${String(config.value.PORT)}`);
});

/** Arrêt propre : on ferme le serveur HTTP puis le pool de connexions. */
function shutdown(): void {
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
