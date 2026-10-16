/**
 * Compteurs d'activité stockés dans Redis.
 *
 * Couche : infrastructure. Implémente `IStatsCounters`. Fail-open : une panne de Redis ne lève jamais d'erreur.
 */
import type { Redis } from "ioredis";
import { COUNTER_NAMES, type CounterName, type CounterValues, type IStatsCounters } from "../../domain/ports/monitoring.js";

const ZERO: CounterValues = { cache_hit: 0, cache_miss: 0, rate_limited: 0 };

/** Compteurs `INCR` sous les clés `ips:stats:<nom>` (sans expiration : ils repartent de zéro quand Redis est vidé). */
export class RedisStatsCounters implements IStatsCounters {
  /**
   * Construit les compteurs.
   *
   * @param redis - Client Redis (préfixe `ips:` déjà appliqué par le client).
   */
  constructor(private readonly redis: Redis) {}

  /** Incrémente atomiquement (`INCR`) ; une erreur est ignorée (un indicateur perdu est sans conséquence). */
  async increment(name: CounterName): Promise<void> {
    try {
      await this.redis.incr(`stats:${name}`);
    } catch {
      // fail-open
    }
  }

  /** Lit tous les compteurs en une commande (`MGET`) ; 0 pour un compteur absent ou si Redis est indisponible. */
  async readAll(): Promise<CounterValues> {
    try {
      const values = await this.redis.mget(COUNTER_NAMES.map((name) => `stats:${name}`));
      const numbers = values.map((value) => (value === null ? 0 : Number(value)));
      return { cache_hit: numbers[0] ?? 0, cache_miss: numbers[1] ?? 0, rate_limited: numbers[2] ?? 0 };
    } catch {
      return ZERO;
    }
  }
}
