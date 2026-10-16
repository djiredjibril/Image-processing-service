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
import { createRedisClient, waitForRedis } from "./infrastructure/cache/redis-client.js";
import { RedisRateLimiter } from "./infrastructure/cache/redis-rate-limiter.js";
import { RedisTransformCache } from "./infrastructure/cache/redis-transform-cache.js";
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
const redis = createRedisClient(config.value.REDIS_URL);
// Brève attente : les premières requêtes ne doivent pas rater le cache parce que la connexion n'est pas encore établie.
// Si Redis est absent, on démarre quand même (cache et rate limiting désactivés, message dans les logs).
if (!(await waitForRedis(redis, 2000))) {
  console.warn("Redis injoignable au démarrage : l'API démarre sans cache ni rate limiting");
}
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
  redis,
  registerUser: new RegisterUser(users, hasher),
  loginUser: new LoginUser(users, hasher, tokens),
  uploadImage,
  getImage: new GetImage(images, storage),
  listImages: new ListImages(images),
  transformImage: new TransformImage(images, storage, processor, new RedisTransformCache(redis, config.value.CACHE_TTL_SECONDS), {
    maxPixelsSide: config.value.MAX_IMAGE_PIXELS_SIDE,
  }),
  tokens,
  rateLimiter: new RedisRateLimiter(redis),
  rateLimits: {
    auth: { limit: config.value.RATE_LIMIT_AUTH, windowSeconds: config.value.RATE_LIMIT_WINDOW_SECONDS },
    upload: { limit: config.value.RATE_LIMIT_UPLOAD, windowSeconds: config.value.RATE_LIMIT_WINDOW_SECONDS },
    transform: { limit: config.value.RATE_LIMIT_TRANSFORM, windowSeconds: config.value.RATE_LIMIT_WINDOW_SECONDS },
    read: { limit: config.value.RATE_LIMIT_READ, windowSeconds: config.value.RATE_LIMIT_WINDOW_SECONDS },
  },
  maxUploadBytes: config.value.MAX_UPLOAD_BYTES,
  corsOrigin: config.value.CORS_ORIGIN,
});

const server = app.listen(config.value.PORT, () => {
  console.log(`Serveur démarré sur le port ${String(config.value.PORT)}`);
});

/** Arrêt propre : on ferme le serveur HTTP puis le pool de connexions. */
function shutdown(): void {
  server.close(() => {
    // `quit` envoie QUIT puis ferme proprement ; s'il échoue (Redis déjà tombé), on coupe la connexion.
    void Promise.all([
      pool.end(),
      redis.quit().catch(() => {
        redis.disconnect();
      }),
    ]).then(() => process.exit(0));
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
