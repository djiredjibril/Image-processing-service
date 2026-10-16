/**
 * Point d'entrée du WORKER : le process qui exécute les transformations en arrière-plan.
 *
 * Couche : composition root (comme `main.ts`, mais sans serveur HTTP). Il se lance à part de l'API
 * (`npm run worker`), ce qui permet de dimensionner séparément l'API et le traitement d'images, et de relancer
 * l'un sans couper l'autre.
 */
import "dotenv/config";
import { loadConfig } from "./infrastructure/config/config.js";
import { isErr } from "./application/shared/result.js";
import { ProcessTransformJob } from "./application/use-cases/process-transform-job.js";
import { TransformImage } from "./application/use-cases/transform-image.js";
import { createRedisClient, waitForRedis } from "./infrastructure/cache/redis-client.js";
import { RedisTransformCache } from "./infrastructure/cache/redis-transform-cache.js";
import { SharpImageProcessor } from "./infrastructure/image/sharp-image-processor.js";
import { createPool } from "./infrastructure/persistence/database.js";
import { PgImageRepository } from "./infrastructure/persistence/pg-image-repository.js";
import { PgTransformJobRepository } from "./infrastructure/persistence/pg-transform-job-repository.js";
import { createWorkerConnection } from "./infrastructure/queue/bull-connection.js";
import { startTransformWorker } from "./infrastructure/queue/transform-worker.js";
import { LocalFileStorage } from "./infrastructure/storage/local-file-storage.js";

const config = loadConfig(process.env);
if (isErr(config)) {
  console.error("Configuration invalide :\n" + config.error.map((line) => ` - ${line}`).join("\n"));
  process.exit(1);
}

const pool = createPool(config.value.DATABASE_URL);
// Client « cache » (fail-fast) : le worker réutilise le cache des transformations et son verrou.
const cacheRedis = createRedisClient(config.value.REDIS_URL);
await waitForRedis(cacheRedis, 2000);
const queueRedis = createWorkerConnection(config.value.REDIS_URL);

const images = new PgImageRepository(pool);
const processor = new SharpImageProcessor({ limitInputPixels: config.value.MAX_IMAGE_PIXELS_SIDE ** 2 });
const transformImage = new TransformImage(
  images,
  new LocalFileStorage(config.value.STORAGE_LOCAL_DIR),
  processor,
  new RedisTransformCache(cacheRedis, config.value.CACHE_TTL_SECONDS),
  { maxPixelsSide: config.value.MAX_IMAGE_PIXELS_SIDE },
);
const worker = startTransformWorker(queueRedis, new ProcessTransformJob(new PgTransformJobRepository(pool), transformImage), {
  concurrency: config.value.WORKER_CONCURRENCY,
});
console.log(`Worker démarré (concurrence : ${String(config.value.WORKER_CONCURRENCY)})`);

let stopping = false;

/**
 * Arrêt propre : le worker finit ses jobs EN COURS (sans en prendre de nouveaux), puis on ferme les connexions.
 * Protégé contre les signaux répétés (Ctrl+C deux fois, ou `tsx` qui relaie le signal) : fermer le pool deux fois plante.
 */
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log("Arrêt du worker : fin des jobs en cours...");
  await worker.close();
  await Promise.all([
    pool.end(),
    queueRedis.quit().catch(() => {
      queueRedis.disconnect();
    }),
    cacheRedis.quit().catch(() => {
      cacheRedis.disconnect();
    }),
  ]);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
