/**
 * Utilitaires de délai pour les appels à la file BullMQ.
 *
 * Couche : infrastructure. BullMQ attend LUI-MÊME que la connexion Redis soit prête, sans limite de temps : avec Redis arrêté,
 * un appel resterait suspendu (et la requête HTTP avec lui). On borne donc ces appels.
 */
import type { Redis } from "ioredis";

/**
 * Attend que la connexion soit prête, au plus `timeoutMs`.
 *
 * @param connection - Connexion Redis.
 * @param timeoutMs - Durée maximale d'attente.
 * @returns `true` si la connexion est prête, `false` si le délai est dépassé.
 */
export function whenReady(connection: Redis, timeoutMs: number): Promise<boolean> {
  if (connection.status === "ready") return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      connection.off("ready", onReady);
      resolve(false);
    }, timeoutMs);
    const onReady = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    connection.once("ready", onReady);
  });
}

/**
 * Rejette si la promesse ne se termine pas dans le délai (la promesse d'origine continue en arrière-plan, sans effet).
 *
 * @param promise - Opération à borner.
 * @param timeoutMs - Délai maximal.
 * @returns La valeur de la promesse, ou un rejet « délai dépassé ».
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  promise.catch(() => undefined);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("délai dépassé"));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
