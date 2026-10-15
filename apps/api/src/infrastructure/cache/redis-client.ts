/**
 * Création du client Redis (bibliothèque `ioredis`).
 *
 * Couche : infrastructure. Redis sert de cache et de compteur de rate limiting : ce sont des optimisations
 * et des protections, pas la source de vérité (PostgreSQL). Le client est donc réglé pour ÉCHOUER VITE
 * quand Redis est indisponible, au lieu de bloquer les requêtes de l'API.
 */
import { Redis } from "ioredis";

/** Préfixe de toutes les clés de l'application : évite les collisions si Redis est partagé. */
export const REDIS_KEY_PREFIX = "ips:";

/** Options de `createRedisClient`. */
export interface RedisClientOptions {
  /** Si `true`, ne se connecte qu'à la première commande (utile pour les tests qui n'utilisent pas Redis). */
  readonly lazyConnect?: boolean;
}

/**
 * Crée un client Redis tolérant aux pannes.
 *
 * Réglages et raisons :
 * - `enableOfflineQueue: false` : sans connexion, une commande échoue immédiatement au lieu d'être mise en
 *   file d'attente (sinon les requêtes HTTP resteraient bloquées jusqu'au retour de Redis) ;
 * - `commandTimeout: 500` : un Redis qui ne répond plus ne doit pas ralentir l'API de plus d'une demi-seconde ;
 * - `retryStrategy` : reconnexion automatique avec un délai croissant (200 ms, 400 ms… plafonné à 5 s) ;
 * - un écouteur `error` : sans lui, une erreur de connexion non écoutée ferait planter tout le process Node.
 *
 * @param url - URL de connexion, ex. `redis://localhost:6380/0` (le dernier chiffre est le numéro de base).
 * @param options - Options facultatives.
 * @returns Un client dont toutes les clés sont préfixées par `ips:`. L'appelant doit appeler `quit()` à l'arrêt.
 */
export function createRedisClient(url: string, options: RedisClientOptions = {}): Redis {
  const client = new Redis(url, {
    keyPrefix: REDIS_KEY_PREFIX,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: 500,
    connectTimeout: 2000,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
    lazyConnect: options.lazyConnect ?? false,
  });

  // On ne logge que la première erreur d'une panne et le retour à la normale : pas un message par tentative.
  let unavailable = false;
  client.on("error", (error: Error) => {
    if (!unavailable) {
      unavailable = true;
      // Une connexion refusée donne parfois un message vide : on retombe sur le code (ECONNREFUSED) ou le nom.
      const reason = error.message || (error as NodeJS.ErrnoException).code || error.name;
      console.error(`Redis indisponible : ${reason}`);
    }
  });
  client.on("ready", () => {
    if (unavailable) {
      unavailable = false;
      console.log("Redis de nouveau disponible");
    }
  });
  return client;
}

/**
 * Teste si Redis répond.
 *
 * @param client - Client Redis.
 * @returns `true` si Redis répond `PONG`, `false` sinon. Ne lève jamais d'erreur.
 */
export async function isRedisUp(client: Redis): Promise<boolean> {
  try {
    await client.ping(); // répond « PONG » ; toute autre issue (timeout, connexion refusée) lève une erreur
    return true;
  } catch {
    return false;
  }
}

/**
 * Attend que le client soit connecté, pendant au plus `timeoutMs`.
 *
 * Pourquoi : sans file d'attente hors-ligne, une commande envoyée avant la fin de la connexion échoue
 * immédiatement. On attend donc brièvement au démarrage, sans jamais bloquer si Redis est absent.
 *
 * @param client - Client Redis.
 * @param timeoutMs - Durée maximale d'attente.
 * @returns `true` si le client est prêt, `false` si le délai est dépassé. Ne lève jamais d'erreur.
 */
export async function waitForRedis(client: Redis, timeoutMs: number): Promise<boolean> {
  if (client.status === "ready") {
    return true;
  }
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      client.off("ready", onReady);
      resolve(false);
    }, timeoutMs);
    const onReady = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    client.once("ready", onReady);
  });
}
