/**
 * Ports de supervision : état de la file, de Redis et compteurs d'activité.
 *
 * Couche : domaine (ports). Servent à OBSERVER le système (page « Supervision » de l'application web), jamais à le piloter.
 * Toutes les implémentations sont « fail-open » : si Redis est indisponible, elles ne lèvent pas d'erreur et le disent (`available: false`).
 */

/** Nombre de jobs par état dans la file. */
export interface QueueCounts {
  readonly waiting: number;
  readonly active: number;
  readonly delayed: number;
  readonly completed: number;
  readonly failed: number;
}

/** Photographie de la file des transformations. */
export interface QueueSnapshot {
  /** `false` si la file (Redis) est injoignable : les chiffres sont alors à zéro et sans signification. */
  readonly available: boolean;
  readonly counts: QueueCounts;
  /** Nombre de workers connectés à la file (0 : les jobs restent en attente). */
  readonly workers: number;
}

/** Contrat de lecture de l'état de la file. */
export interface IQueueMonitor {
  /**
   * Lit l'état de la file.
   *
   * @returns La photographie ; ne lève jamais d'erreur (`available: false` si la file est injoignable, en moins de ~2 s).
   */
  snapshot(): Promise<QueueSnapshot>;
}

/** Nombre de clés Redis de l'application, par famille. */
export interface RedisKeyCounts {
  /** Entrées du cache des transformations (`cache:transform:*`). */
  readonly cacheEntries: number;
  /** Verrous anti-ruée en cours (`lock:transform:*`). */
  readonly activeLocks: number;
  /** Compteurs de rate limiting (`ratelimit:*`). */
  readonly rateLimitCounters: number;
  /** Clés de la file BullMQ (`bull:*`). */
  readonly queueKeys: number;
}

/** Photographie de Redis. */
export interface RedisStats {
  /** `false` si Redis ne répond pas : les autres champs valent alors `null`. */
  readonly available: boolean;
  readonly version: string | null;
  readonly usedMemoryBytes: number | null;
  readonly connectedClients: number | null;
  readonly uptimeSeconds: number | null;
  readonly keys: RedisKeyCounts | null;
  /** `true` si le comptage des clés a été plafonné (très nombreuses clés) : les nombres sont des minorants. */
  readonly approximate: boolean;
}

/** Contrat de lecture de l'état de Redis. */
export interface IRedisMonitor {
  /**
   * Lit l'état de Redis.
   *
   * @returns La photographie ; ne lève jamais d'erreur (`available: false` si Redis est injoignable).
   */
  stats(): Promise<RedisStats>;
}

/** Compteurs d'activité tenus par l'application. */
export const COUNTER_NAMES = ["cache_hit", "cache_miss", "rate_limited"] as const;
/** Nom d'un compteur. */
export type CounterName = (typeof COUNTER_NAMES)[number];
/** Valeur de tous les compteurs. */
export type CounterValues = Readonly<Record<CounterName, number>>;

/**
 * Contrat des compteurs d'activité (réponses servies par le cache, calculs réels, requêtes refusées par le rate limiting).
 *
 * Ce sont des indicateurs : fail-open, jamais d'erreur, et une valeur perdue est sans conséquence.
 */
export interface IStatsCounters {
  /**
   * Ajoute 1 à un compteur. Ne lève jamais d'erreur ; ne bloque pas l'appelant plus que nécessaire.
   *
   * @param name - Compteur à incrémenter.
   */
  increment(name: CounterName): Promise<void>;

  /**
   * Lit tous les compteurs.
   *
   * @returns Les valeurs (0 pour un compteur jamais incrémenté ou si le stockage est indisponible).
   */
  readAll(): Promise<CounterValues>;
}

/** Compteurs qui ne font rien (par défaut dans les contextes sans supervision). */
export const NO_STATS: IStatsCounters = {
  increment: () => Promise.resolve(),
  readAll: () => Promise.resolve({ cache_hit: 0, cache_miss: 0, rate_limited: 0 }),
};
