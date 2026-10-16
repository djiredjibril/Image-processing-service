/**
 * Worker BullMQ : exécute les jobs de transformation.
 *
 * Couche : infrastructure. Adapte BullMQ (file, nouvelles tentatives) au use case `ProcessTransformJob`.
 */
import { UnrecoverableError, Worker } from "bullmq";
import type { Redis } from "ioredis";
import type { ProcessTransformJob } from "../../application/use-cases/process-transform-job.js";
import { isErr } from "../../domain/shared/result.js";
import { BULL_PREFIX, TRANSFORM_QUEUE_NAME } from "./bull-connection.js";
import type { TransformJobData } from "./bullmq-transform-job-queue.js";

/** Réglages du worker. */
export interface TransformWorkerOptions {
  /**
   * Nombre de jobs traités EN MÊME TEMPS par ce process. Chaque traitement sharp peut consommer ~1 Go pour une image
   * de 49 Mpx : une valeur basse protège la RAM (on monte le débit en lançant plusieurs process, pas en augmentant ceci).
   */
  readonly concurrency: number;
}

/**
 * Démarre un worker.
 *
 * Garanties : un job terminé en échec MÉTIER est « réussi » pour BullMQ (son statut est en base) ; une panne technique
 * relance la file (avec backoff) ; à la dernière tentative, le job passe `failed` en base.
 *
 * @param connection - Connexion créée par `createWorkerConnection` (fermée par l'appelant APRÈS `worker.close()`).
 * @param processJob - Use case qui exécute un job.
 * @param options - Concurrence.
 * @returns Le worker ; `await worker.close()` attend la fin des jobs en cours (arrêt propre).
 */
export function startTransformWorker(connection: Redis, processJob: ProcessTransformJob, options: TransformWorkerOptions): Worker<TransformJobData> {
  const worker = new Worker<TransformJobData>(
    TRANSFORM_QUEUE_NAME,
    async (job) => {
      const result = await processJob.execute(job.data.jobId);
      if (isErr(result)) {
        // Le job n'existe plus en base : réessayer ne servirait à rien.
        throw new UnrecoverableError("Job introuvable en base");
      }
      return result.value;
    },
    { connection, prefix: BULL_PREFIX, concurrency: options.concurrency },
  );

  worker.on("failed", (job, error) => {
    if (job === undefined) return;
    const attempts = job.opts.attempts ?? 1;
    const exhausted = error instanceof UnrecoverableError || job.attemptsMade >= attempts;
    console.error(`Job ${job.data.jobId} : tentative ${String(job.attemptsMade)}/${String(attempts)} échouée : ${error.message}`);
    if (exhausted) {
      processJob.recordFinalFailure(job.data.jobId).catch((cause: unknown) => {
        console.error(`Job ${job.data.jobId} : impossible d'enregistrer l'échec définitif`, cause);
      });
    }
  });
  worker.on("error", () => undefined); // erreurs de connexion : déjà journalisées par la connexion

  return worker;
}
