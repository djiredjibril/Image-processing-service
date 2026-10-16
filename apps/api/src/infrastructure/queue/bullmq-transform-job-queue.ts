/**
 * Producteur BullMQ de la file des transformations.
 *
 * Couche : infrastructure. Implémente `ITransformJobQueue`.
 */
import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { QueueUnavailableError } from "../../domain/errors/job-errors.js";
import type { ITransformJobQueue } from "../../domain/ports/transform-job-queue.js";
import { err, ok, type Result } from "../../domain/shared/result.js";
import { BULL_PREFIX, TRANSFORM_QUEUE_NAME } from "./bull-connection.js";
import { whenReady, withTimeout } from "./timeouts.js";

/** Réglages de nouvelle tentative des jobs. */
export interface RetryOptions {
  /** Nombre total de tentatives (1 = aucune nouvelle tentative). */
  readonly attempts: number;
  /** Délai avant la 1re nouvelle tentative, en ms ; il double à chaque échec (backoff exponentiel). */
  readonly backoffMs: number;
}

/** Charge utile d'un job dans la file : uniquement l'identifiant (les paramètres vivent en base). */
export interface TransformJobData {
  readonly jobId: string;
}

/** Nom du job dans la file. */
export const TRANSFORM_JOB_NAME = "transform";

/** Durée maximale d'attente d'une connexion Redis non prête, et d'une commande sans réponse, avant de déclarer la file indisponible. */
const AVAILABILITY_TIMEOUT_MS = 1000;
const ADD_TIMEOUT_MS = 3000;

/** File BullMQ des transformations (côté producteur : l'API). */
export class BullMqTransformJobQueue implements ITransformJobQueue {
  private readonly queue: Queue<TransformJobData>;

  /**
   * Construit le producteur.
   *
   * @param connection - Connexion créée par `createQueueConnection` (fermée par l'appelant).
   * @param retry - Réglages de nouvelle tentative.
   */
  constructor(
    private readonly connection: Redis,
    private readonly retry: RetryOptions,
  ) {
    this.queue = new Queue<TransformJobData>(TRANSFORM_QUEUE_NAME, { connection, prefix: BULL_PREFIX });
    // Une erreur de connexion non écoutée ferait planter le process.
    this.queue.on("error", () => undefined);
  }

  /**
   * Met le job en file. Le job BullMQ reçoit le MÊME identifiant que le job en base : une double mise en file du
   * même identifiant est ignorée par BullMQ (idempotence), et un job se retrouve facilement dans les deux mondes.
   *
   * @param jobId - Identifiant du job enregistré en base.
   * @returns `Ok` si la file a accepté le job, `Err(QueueUnavailableError)` si Redis est injoignable (réponse en ~1 s
   * au plus, jamais d'attente indéfinie).
   */
  async enqueue(jobId: string): Promise<Result<void, QueueUnavailableError>> {
    if (!(await whenReady(this.connection, AVAILABILITY_TIMEOUT_MS))) {
      return err(new QueueUnavailableError());
    }
    try {
      await withTimeout(
        this.queue.add(
        TRANSFORM_JOB_NAME,
        { jobId },
        {
          jobId,
          attempts: this.retry.attempts,
          backoff: { type: "exponential", delay: this.retry.backoffMs },
          // Le statut fait foi en base : on ne garde pas l'historique dans Redis (mémoire limitée).
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 86_400, count: 1000 },
        },
        ),
        ADD_TIMEOUT_MS,
      );
      return ok(undefined);
    } catch {
      return err(new QueueUnavailableError());
    }
  }

  /** Ferme la file (la connexion appartient à l'appelant, elle reste ouverte). */
  async close(): Promise<void> {
    await this.queue.close();
  }
}
