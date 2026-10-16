/**
 * Modèles de la supervision (contrat JSON de `GET /monitoring/overview`).
 */
import { JobSummary } from '../images/transform.models';

/** Nombre de jobs par état dans la file. */
export interface QueueCounts {
  readonly waiting: number;
  readonly active: number;
  readonly delayed: number;
  readonly completed: number;
  readonly failed: number;
}

/** État de la file des transformations. */
export interface QueueState {
  /** `false` si la file (Redis) est injoignable. */
  readonly available: boolean;
  readonly counts: QueueCounts;
  /** Workers connectés (0 : les jobs restent en attente). */
  readonly workers: number;
}

/** Nombre de clés Redis de l'application par famille. */
export interface RedisKeyCounts {
  readonly cacheEntries: number;
  readonly activeLocks: number;
  readonly rateLimitCounters: number;
  readonly queueKeys: number;
}

/** État de Redis. */
export interface RedisState {
  /** `false` si Redis ne répond pas : les autres champs valent alors `null`. */
  readonly available: boolean;
  readonly version: string | null;
  readonly usedMemoryBytes: number | null;
  readonly connectedClients: number | null;
  readonly uptimeSeconds: number | null;
  readonly keys: RedisKeyCounts | null;
  /** `true` si le comptage des clés a été plafonné (les nombres sont des minorants). */
  readonly approximate: boolean;
}

/** Compteurs d'activité globaux. */
export interface ActivityCounters {
  readonly cache_hit: number;
  readonly cache_miss: number;
  readonly rate_limited: number;
}

/** Vue d'ensemble renvoyée par l'API. */
export interface MonitoringOverview {
  /** Date ISO 8601 de la photographie. */
  readonly generatedAt: string;
  readonly redis: RedisState;
  readonly queue: QueueState;
  readonly counters: ActivityCounters;
  /** Les jobs récents de l'utilisateur connecté uniquement. */
  readonly recentJobs: readonly JobSummary[];
}

/** Un relevé tel que le voit la page : une vue d'ensemble, ou l'échec de la lecture. */
export type MonitoringReading =
  | { readonly ok: true; readonly overview: MonitoringOverview }
  | { readonly ok: false; readonly message: string };
