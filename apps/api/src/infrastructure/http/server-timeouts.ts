/**
 * Délais de protection du serveur HTTP.
 *
 * Couche : infrastructure (HTTP). Contre les clients lents (« slowloris ») qui ouvrent des connexions et les gardent
 * ouvertes en envoyant un octet de temps en temps, pour épuiser les connexions du serveur.
 */
import type { Server } from "node:http";

/** Délais, en millisecondes. */
export interface ServerTimeouts {
  /** Temps maximal pour recevoir TOUS les en-têtes d'une requête. */
  readonly headersTimeoutMs: number;
  /** Temps maximal pour recevoir la requête entière (en-têtes + corps, donc un envoi d'image comprise). */
  readonly requestTimeoutMs: number;
  /** Durée pendant laquelle une connexion inactive est gardée ouverte entre deux requêtes. */
  readonly keepAliveTimeoutMs: number;
}

/** Valeurs par défaut : une image de 10 Mo doit pouvoir arriver sur une liaison lente, mais pas indéfiniment. */
export const DEFAULT_SERVER_TIMEOUTS: ServerTimeouts = {
  headersTimeoutMs: 10_000,
  requestTimeoutMs: 60_000,
  keepAliveTimeoutMs: 5_000,
};

/**
 * Applique les délais au serveur.
 *
 * Note : `headersTimeout` doit rester supérieur à `keepAliveTimeout` (sinon Node peut couper une connexion réutilisée) ;
 * l'appelant fournit des valeurs cohérentes, et cette fonction relève `headersTimeout` au besoin.
 *
 * @param server - Serveur HTTP Node.
 * @param timeouts - Délais à appliquer.
 */
export function configureServerTimeouts(server: Server, timeouts: ServerTimeouts = DEFAULT_SERVER_TIMEOUTS): void {
  server.keepAliveTimeout = timeouts.keepAliveTimeoutMs;
  server.headersTimeout = Math.max(timeouts.headersTimeoutMs, timeouts.keepAliveTimeoutMs + 1000);
  server.requestTimeout = timeouts.requestTimeoutMs;
}
