/**
 * Connexions Redis dédiées à BullMQ.
 *
 * Couche : infrastructure. BullMQ a des exigences incompatibles avec le client « fail-fast » du cache
 * (`createRedisClient`) : pas de `keyPrefix` ioredis (il a son propre `prefix`), et le worker utilise des commandes
 * BLOQUANTES qui exigent `maxRetriesPerRequest: null` et AUCUN `commandTimeout`. D'où des connexions séparées.
 */
import { Redis } from "ioredis";

/** Préfixe BullMQ de toutes les clés de file : `ips:bull:<file>:...` (cohérent avec le préfixe `ips:` du cache). */
export const BULL_PREFIX = "ips:bull";

/** Nom de la file des transformations d'images. */
export const TRANSFORM_QUEUE_NAME = "transform-image";

function logErrors(client: Redis, label: string): void {
  let unavailable = false;
  client.on("error", (error: Error) => {
    if (!unavailable) {
      unavailable = true;
      console.error(`Redis (${label}) indisponible : ${error.message || (error as NodeJS.ErrnoException).code || error.name}`);
    }
  });
  client.on("ready", () => {
    if (unavailable) {
      unavailable = false;
      console.log(`Redis (${label}) de nouveau disponible`);
    }
  });
}

/**
 * Connexion du PRODUCTEUR (l'API qui met les jobs en file).
 *
 * `enableOfflineQueue: false` : si Redis est injoignable, `queue.add` échoue tout de suite (on répond 503) au lieu
 * d'attendre indéfiniment. `commandTimeout` borne aussi une commande qui ne reçoit pas de réponse.
 *
 * @param url - URL Redis (ex. `redis://localhost:6380/0`).
 * @returns Un client à fermer avec `quit()` à l'arrêt.
 */
export function createQueueConnection(url: string): Redis {
  const client = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: null,
    commandTimeout: 2000,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
  });
  logErrors(client, "file, producteur");
  return client;
}

/**
 * Connexion du WORKER (le process qui exécute les jobs).
 *
 * `maxRetriesPerRequest: null` : le worker attend les jobs avec des commandes bloquantes ; sans cela, ioredis les
 * abandonnerait. Pas de `commandTimeout` pour la même raison. Il se reconnecte seul si Redis redémarre.
 *
 * @param url - URL Redis.
 * @returns Un client à fermer avec `quit()` à l'arrêt.
 */
export function createWorkerConnection(url: string): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: null,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
  });
  logErrors(client, "worker");
  return client;
}
