/**
 * Lecture de l'état de Redis (mémoire, clients, clés de l'application par famille).
 *
 * Couche : infrastructure. Implémente `IRedisMonitor`. Lecture seule, fail-open.
 */
import type { Redis } from "ioredis";
import type { IRedisMonitor, RedisKeyCounts, RedisStats } from "../../domain/ports/monitoring.js";
import { REDIS_KEY_PREFIX } from "./redis-client.js";

/** Plafond du parcours des clés : `SCAN` est incrémental, mais on ne veut pas parcourir des millions de clés à chaque lecture. */
const MAX_SCAN_ITERATIONS = 20;
const SCAN_COUNT = 1000;
const UNAVAILABLE: RedisStats = { available: false, version: null, usedMemoryBytes: null, connectedClients: null, uptimeSeconds: null, keys: null, approximate: false };

/** Extrait un nombre d'une ligne `clé:valeur` de la sortie de `INFO`. */
function infoNumber(info: string, key: string): number | null {
  const match = new RegExp(`^${key}:(\\d+)`, "m").exec(info);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** Observateur de Redis. */
export class RedisMonitor implements IRedisMonitor {
  /**
   * Construit l'observateur.
   *
   * @param redis - Client Redis de l'application (préfixe `ips:`).
   * @param scan - Réglages du parcours des clés (surchargés par les tests pour provoquer le plafonnement).
   */
  constructor(
    private readonly redis: Redis,
    private readonly scan: { readonly maxIterations: number; readonly count: number } = { maxIterations: MAX_SCAN_ITERATIONS, count: SCAN_COUNT },
  ) {}

  /**
   * Lit `INFO` (version, mémoire, clients, durée de fonctionnement) puis compte les clés de l'application avec `SCAN`.
   *
   * `SCAN` plutôt que `KEYS` : `KEYS` bloque Redis pendant tout le parcours (dangereux en production) ; `SCAN` avance par petits pas.
   *
   * @returns La photographie, ou `available: false` si Redis ne répond pas.
   */
  async stats(): Promise<RedisStats> {
    try {
      const info = await this.redis.info();
      const version = /^redis_version:(\S+)/m.exec(info)?.[1] ?? null;
      const { keys, approximate } = await this.countKeys();
      return {
        available: true,
        version,
        usedMemoryBytes: infoNumber(info, "used_memory"),
        connectedClients: infoNumber(info, "connected_clients"),
        uptimeSeconds: infoNumber(info, "uptime_in_seconds"),
        keys,
        approximate,
      };
    } catch {
      return UNAVAILABLE;
    }
  }

  /** Parcourt les clés `ips:*` et les range par famille. Le motif de `SCAN` contient le préfixe complet (ioredis ne le préfixe pas). */
  private async countKeys(): Promise<{ keys: RedisKeyCounts; approximate: boolean }> {
    const counts = { cacheEntries: 0, activeLocks: 0, rateLimitCounters: 0, queueKeys: 0 };
    let cursor = "0";
    let iterations = 0;
    do {
      const [next, batch] = await this.redis.scan(cursor, "MATCH", `${REDIS_KEY_PREFIX}*`, "COUNT", this.scan.count);
      cursor = next;
      iterations += 1;
      for (const key of batch) {
        const name = key.slice(REDIS_KEY_PREFIX.length);
        if (name.startsWith("cache:transform:")) counts.cacheEntries += 1;
        else if (name.startsWith("lock:transform:")) counts.activeLocks += 1;
        else if (name.startsWith("ratelimit:")) counts.rateLimitCounters += 1;
        else if (name.startsWith("bull:")) counts.queueKeys += 1;
      }
    } while (cursor !== "0" && iterations < this.scan.maxIterations);
    return { keys: counts, approximate: cursor !== "0" };
  }
}
