/**
 * Use case `GetMonitoringOverview` : photographie du système pour la page « Supervision ».
 *
 * Couche : application.
 */
import type { CounterValues, IQueueMonitor, IRedisMonitor, IStatsCounters, QueueSnapshot, RedisStats } from "../../domain/ports/monitoring.js";
import type { IImageRepository } from "../../domain/repositories/image-repository.js";
import type { ITransformJobRepository } from "../../domain/repositories/transform-job-repository.js";
import { toImageSummary } from "../shared/image-summary.js";
import { type JobSummary, toJobSummary } from "../shared/job-summary.js";

/** Nombre de jobs récents de l'utilisateur renvoyés. */
export const RECENT_JOBS_LIMIT = 10;

/** Vue d'ensemble renvoyée au client. */
export interface MonitoringOverview {
  /** Date de la photographie (ISO 8601 une fois sérialisée). */
  readonly generatedAt: Date;
  readonly redis: RedisStats;
  readonly queue: QueueSnapshot;
  /** Compteurs d'activité GLOBAUX (cache, rate limiting) depuis le dernier vidage de Redis. */
  readonly counters: CounterValues;
  /** Les jobs récents de l'UTILISATEUR APPELANT uniquement. */
  readonly recentJobs: readonly JobSummary[];
}

/**
 * Rassemble l'état de Redis, de la file, les compteurs d'activité et les jobs de l'appelant.
 *
 * Confidentialité : les chiffres de la file, de Redis et les compteurs sont GLOBAUX (charge du système, aucune donnée d'utilisateur) ;
 * seuls les jobs listés sont ceux de l'appelant. Aucun identifiant de worker, adresse réseau ni clé Redis n'est exposé.
 */
export class GetMonitoringOverview {
  /**
   * Construit le use case.
   *
   * @param redisMonitor - Lecture de Redis.
   * @param queueMonitor - Lecture de la file.
   * @param counters - Compteurs d'activité.
   * @param jobs - Jobs (pour les jobs récents de l'appelant).
   * @param images - Images (pour joindre le dérivé d'un job terminé).
   */
  constructor(
    private readonly redisMonitor: IRedisMonitor,
    private readonly queueMonitor: IQueueMonitor,
    private readonly counters: IStatsCounters,
    private readonly jobs: ITransformJobRepository,
    private readonly images: IImageRepository,
  ) {}

  /**
   * Construit la vue d'ensemble.
   *
   * @param ownerId - Utilisateur appelant (ses jobs uniquement).
   * @returns La vue d'ensemble. Redis et la file indisponibles ne sont pas des erreurs : leur état est `available: false`.
   * @throws Si la base de données tombe en panne.
   */
  async execute(ownerId: string): Promise<MonitoringOverview> {
    const [redis, queue, counters, recent] = await Promise.all([
      this.redisMonitor.stats(),
      this.queueMonitor.snapshot(),
      this.counters.readAll(),
      this.jobs.listRecentByOwner(ownerId, RECENT_JOBS_LIMIT),
    ]);
    const recentJobs = await Promise.all(
      recent.map(async (job) => {
        const resultId = job.props.resultImageId;
        const image = job.status === "completed" && resultId !== null ? await this.images.findById(resultId) : null;
        return toJobSummary(job, image === null ? null : toImageSummary(image));
      }),
    );
    return { generatedAt: new Date(), redis, queue, counters, recentJobs };
  }
}
