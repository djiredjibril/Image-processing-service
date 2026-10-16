/**
 * Lecture de l'état de la file BullMQ (compteurs par état, workers connectés).
 *
 * Couche : infrastructure. Implémente `IQueueMonitor`. Lecture seule : ne modifie jamais la file.
 */
import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { IQueueMonitor, QueueSnapshot } from "../../domain/ports/monitoring.js";
import { BULL_PREFIX, TRANSFORM_QUEUE_NAME } from "./bull-connection.js";
import { whenReady, withTimeout } from "./timeouts.js";

const READ_TIMEOUT_MS = 1500;
const UNAVAILABLE: QueueSnapshot = {
  available: false,
  counts: { waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 },
  workers: 0,
};

/** Observateur de la file des transformations. */
export class BullMqQueueMonitor implements IQueueMonitor {
  private readonly queue: Queue;

  /**
   * Construit l'observateur.
   *
   * @param connection - Connexion créée par `createQueueConnection` (fermée par l'appelant).
   */
  constructor(private readonly connection: Redis) {
    this.queue = new Queue(TRANSFORM_QUEUE_NAME, { connection, prefix: BULL_PREFIX });
    this.queue.on("error", () => undefined);
  }

  /**
   * Compte les jobs par état et les workers connectés (commande Redis `CLIENT LIST`, filtrée par BullMQ).
   *
   * @returns La photographie, ou `available: false` si Redis ne répond pas dans le délai (~1,5 s).
   */
  async snapshot(): Promise<QueueSnapshot> {
    if (!(await whenReady(this.connection, 500))) return UNAVAILABLE;
    try {
      const [counts, workers] = await withTimeout(Promise.all([this.queue.getJobCounts("waiting", "active", "delayed", "completed", "failed"), this.queue.getWorkers()]), READ_TIMEOUT_MS);
      return {
        available: true,
        counts: {
          waiting: counts["waiting"] ?? 0,
          active: counts["active"] ?? 0,
          delayed: counts["delayed"] ?? 0,
          completed: counts["completed"] ?? 0,
          failed: counts["failed"] ?? 0,
        },
        workers: workers.length,
      };
    } catch {
      return UNAVAILABLE;
    }
  }

  /** Ferme la file (la connexion appartient à l'appelant). */
  async close(): Promise<void> {
    await this.queue.close();
  }
}
