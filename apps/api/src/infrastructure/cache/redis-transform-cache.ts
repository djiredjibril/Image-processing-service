/**
 * Implémentation Redis de `ITransformCache`.
 *
 * Couche : infrastructure (cache). Entrées : `cache:transform:<hash>` → identifiant du dérivé (avec durée de
 * vie) ; verrous : `lock:transform:<hash>` → jeton aléatoire du détenteur. Toutes les méthodes sont fail-open.
 */
import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { CacheLock, ITransformCache } from "../../domain/ports/transform-cache.js";
import type { TransformCacheKey } from "../../domain/value-objects/transform-cache-key.js";

/** Durée de vie d'un verrou : filet de sécurité si son détenteur plante avant de le libérer. */
export const LOCK_TTL_MS = 30_000;
const POLL_INTERVAL_MS = 100;

// Supprime le verrou SEULEMENT s'il contient encore NOTRE jeton. Sans cette comparaison, un détenteur lent dont le
// verrou a expiré supprimerait le verrou d'un autre. « Lire puis supprimer » doit être atomique : d'où un script Lua.
const RELEASE_IF_OWNER = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0`;

/** Verrou accordé quand Redis est indisponible : on continue sans protection plutôt que de bloquer. */
const NO_OP_LOCK: CacheLock = {
  release: () => Promise.resolve(),
};

const entryKey = (key: TransformCacheKey): string => `cache:transform:${key.value}`;
const lockKey = (key: TransformCacheKey): string => `lock:transform:${key.value}`;

/** Cache des transformations adossé à Redis. */
export class RedisTransformCache implements ITransformCache {
  /**
   * Prépare le cache.
   *
   * @param redis - Client Redis (les clés sont préfixées par le client).
   * @param ttlSeconds - Durée de vie d'une entrée de cache, en secondes.
   */
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {}

  /** Lit l'entrée ; `null` si elle est absente ou si Redis est indisponible. */
  async get(key: TransformCacheKey): Promise<string | null> {
    try {
      return await this.redis.get(entryKey(key));
    } catch {
      return null; // fail-open : le client Redis a déjà signalé la panne dans les logs
    }
  }

  /** Écrit l'entrée avec sa durée de vie ; ne fait rien si Redis est indisponible. */
  async set(key: TransformCacheKey, derivedImageId: string): Promise<void> {
    try {
      await this.redis.set(entryKey(key), derivedImageId, "EX", this.ttlSeconds);
    } catch {
      // fail-open : sans cache, la prochaine requête identique recalculera simplement
    }
  }

  /**
   * Pose le verrou avec `SET ... NX PX` : « seulement si la clé n'existe pas », avec expiration, en une commande
   * atomique. Renvoie `null` si quelqu'un d'autre le détient ; un verrou sans effet si Redis est indisponible.
   */
  async acquireLock(key: TransformCacheKey): Promise<CacheLock | null> {
    const token = randomUUID();
    try {
      const reply = await this.redis.set(lockKey(key), token, "PX", LOCK_TTL_MS, "NX");
      if (reply !== "OK") {
        return null;
      }
    } catch {
      return NO_OP_LOCK;
    }
    return {
      release: async () => {
        try {
          await this.redis.eval(RELEASE_IF_OWNER, 1, lockKey(key), token);
        } catch {
          // fail-open : le verrou expirera tout seul
        }
      },
    };
  }

  /**
   * Attend (par sondage toutes les 100 ms) que le résultat apparaisse. S'arrête dès que le verrou a disparu
   * sans résultat (le détenteur a échoué) : inutile d'attendre davantage, on recalculera.
   */
  async waitFor(key: TransformCacheKey, timeoutMs: number): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    try {
      while (Date.now() < deadline) {
        const value = await this.redis.get(entryKey(key));
        if (value !== null) {
          return value;
        }
        if ((await this.redis.exists(lockKey(key))) === 0) {
          return null;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    } catch {
      return null;
    }
    return null;
  }
}
