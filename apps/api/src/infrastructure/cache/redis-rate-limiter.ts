/**
 * Limiteur de débit à fenêtre fixe, stocké dans Redis.
 *
 * Couche : infrastructure. Implémente `IRateLimiter`. Fail-open : si Redis est indisponible, aucune
 * erreur n'est levée et `consume` renvoie `null` (la requête passe).
 */
import type { Redis } from "ioredis";
import type { IRateLimiter, RateLimitDecision, RateLimitPolicy } from "../../domain/ports/rate-limiter.js";

/**
 * Script Lua exécuté d'un bloc par Redis (donc atomique) : incrémente le compteur, lui donne une durée de vie
 * à la première requête de la fenêtre, puis renvoie `{compteur, ms restantes}`.
 *
 * Pourquoi un script plutôt que `INCR` puis `PEXPIRE` depuis Node : si le process s'arrêtait entre les deux
 * commandes, la clé n'expirerait jamais et l'utilisateur serait bloqué pour toujours. La garde `ttl < 0`
 * répare aussi une clé qui aurait perdu son expiration.
 */
const INCREMENT_WINDOW = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {count, ttl}
`;

/** Limiteur de débit Redis (fenêtre fixe, clés `ips:ratelimit:<clé>`). */
export class RedisRateLimiter implements IRateLimiter {
  /**
   * Construit le limiteur.
   *
   * @param redis - Client Redis (préfixe `ips:` déjà appliqué par le client).
   */
  constructor(private readonly redis: Redis) {}

  /**
   * Compte une requête dans la fenêtre courante.
   *
   * @param key - Identité limitée, ex. `upload:<userId>`.
   * @param policy - Règle à appliquer.
   * @returns La décision, ou `null` si Redis est indisponible ou répond de façon inattendue.
   */
  async consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision | null> {
    try {
      const reply = await this.redis.eval(INCREMENT_WINDOW, 1, `ratelimit:${key}`, String(policy.windowSeconds * 1000));
      if (!Array.isArray(reply)) return null;
      const [count, ttlMs] = reply as unknown[];
      if (typeof count !== "number" || typeof ttlMs !== "number") return null;
      return {
        allowed: count <= policy.limit,
        limit: policy.limit,
        remaining: Math.max(0, policy.limit - count),
        resetSeconds: Math.max(1, Math.ceil(ttlMs / 1000)),
      };
    } catch {
      return null;
    }
  }
}
