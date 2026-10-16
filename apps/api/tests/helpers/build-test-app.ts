/** Aide de test : assemble l'app Express complète avec les vraies implémentations. */
import type { Express } from "express";
import type { Redis } from "ioredis";
import type pg from "pg";
import { EnqueueTransformJob } from "../../src/application/use-cases/enqueue-transform-job.js";
import { GetJob } from "../../src/application/use-cases/get-job.js";
import type { ITransformJobQueue } from "../../src/domain/ports/transform-job-queue.js";
import { PgTransformJobRepository } from "../../src/infrastructure/persistence/pg-transform-job-repository.js";
import { FakeTransformJobQueue } from "../fakes/fake-transform-job-queue.js";
import { GetImage } from "../../src/application/use-cases/get-image.js";
import { ListImages } from "../../src/application/use-cases/list-images.js";
import { LoginUser } from "../../src/application/use-cases/login-user.js";
import { RegisterUser } from "../../src/application/use-cases/register-user.js";
import { TransformImage } from "../../src/application/use-cases/transform-image.js";
import { UploadImage } from "../../src/application/use-cases/upload-image.js";
import type { ITransformCache } from "../../src/domain/ports/transform-cache.js";
import { createRedisClient } from "../../src/infrastructure/cache/redis-client.js";
import { createApp } from "../../src/infrastructure/http/app.js";
import { SharpImageProcessor } from "../../src/infrastructure/image/sharp-image-processor.js";
import { PgImageRepository } from "../../src/infrastructure/persistence/pg-image-repository.js";
import { PgUserRepository } from "../../src/infrastructure/persistence/pg-user-repository.js";
import { JwtTokenService } from "../../src/infrastructure/security/jwt-token-service.js";
import { Argon2PasswordHasher } from "../../src/infrastructure/security/argon2-password-hasher.js";
import { LocalFileStorage } from "../../src/infrastructure/storage/local-file-storage.js";
import type { IRateLimiter } from "../../src/domain/ports/rate-limiter.js";
import type { RateLimitsConfig } from "../../src/infrastructure/http/rate-limit-middleware.js";
import { InMemoryRateLimiter } from "../fakes/in-memory-rate-limiter.js";
import { InMemoryTransformCache } from "../fakes/in-memory-transform-cache.js";
import { testRedisUrl } from "./test-redis.js";

/** Secret de signature utilisé uniquement dans les tests. */
export const TEST_JWT_SECRET = "test-secret-test-secret-test-secret-1234";

/** Options de l'application de test. */
export interface TestAppOptions {
  /** Dossier de stockage (un dossier temporaire par fichier de test). */
  readonly storageDir?: string;
  readonly maxUploadBytes?: number;
  readonly maxPixelsSide?: number;
  /** Origine CORS autorisée (défaut : celle de l'app Angular en dev). */
  readonly corsOrigin?: string;
  /** Client Redis ; par défaut un client « paresseux » qui ne se connecte jamais tant qu'on ne l'utilise pas. */
  readonly redis?: Redis;
  /** Cache des transformations ; par défaut un cache en mémoire NEUF par application (aucune fuite entre tests). */
  readonly cache?: ITransformCache;
  /** File des jobs ; par défaut une file factice NEUVE (aucun worker : les jobs restent `queued`). */
  readonly jobQueue?: ITransformJobQueue;
  /** Limiteur de débit ; par défaut un limiteur en mémoire NEUF par application. */
  readonly rateLimiter?: IRateLimiter;
  /** Règles de limitation ; par défaut très hautes pour ne jamais gêner les autres tests. */
  readonly rateLimits?: RateLimitsConfig;
}

const NEVER_LIMITED = { limit: 1_000_000, windowSeconds: 60 };

/** Construit l'application avec la base de test fournie (limites par défaut : 10 Mo, 8000 px). */
export function buildTestApp(pool: pg.Pool, options: TestAppOptions = {}): Express {
  const maxUploadBytes = options.maxUploadBytes ?? 10_485_760;
  const users = new PgUserRepository(pool);
  const hasher = new Argon2PasswordHasher();
  const tokens = new JwtTokenService(TEST_JWT_SECRET, "1h");
  const storage = new LocalFileStorage(options.storageDir ?? "storage-test");
  const images = new PgImageRepository(pool);
  const transformJobs = new PgTransformJobRepository(pool);
  const maxPixelsSide = options.maxPixelsSide ?? 8000;
  const processor = new SharpImageProcessor({ limitInputPixels: maxPixelsSide ** 2 });
  const uploadImage = new UploadImage(storage, processor, images, { maxBytes: maxUploadBytes, maxPixelsSide });
  return createApp({
    pool,
    redis: options.redis ?? createRedisClient(testRedisUrl(), { lazyConnect: true }),
    registerUser: new RegisterUser(users, hasher),
    loginUser: new LoginUser(users, hasher, tokens),
    uploadImage,
    getImage: new GetImage(images, storage),
    listImages: new ListImages(images),
    transformImage: new TransformImage(images, storage, processor, options.cache ?? new InMemoryTransformCache(), { maxPixelsSide }),
    enqueueTransformJob: new EnqueueTransformJob(images, transformJobs, options.jobQueue ?? new FakeTransformJobQueue(), { maxPixelsSide }),
    getJob: new GetJob(transformJobs, images),
    tokens,
    rateLimiter: options.rateLimiter ?? new InMemoryRateLimiter(),
    rateLimits: options.rateLimits ?? { auth: NEVER_LIMITED, upload: NEVER_LIMITED, transform: NEVER_LIMITED, read: NEVER_LIMITED },
    maxUploadBytes,
    corsOrigin: options.corsOrigin ?? "http://localhost:4200",
  });
}
