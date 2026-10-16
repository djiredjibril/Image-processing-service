/**
 * Middleware de plafond de requêtes EN COURS (concurrence).
 *
 * Couche : infrastructure (HTTP). Protège la mémoire du process : une transformation sharp peut occuper ~1 Go pour une
 * image de 49 Mpx. Le rate limiting borne le NOMBRE de requêtes par minute, pas combien tournent en même temps : dix
 * requêtes lentes simultanées peuvent épuiser la RAM sans jamais dépasser un quota.
 */
import type { RequestHandler } from "express";

/**
 * Construit un middleware qui n'autorise que `max` requêtes simultanées dans ce process.
 *
 * Au-delà, la requête est refusée tout de suite (503 + `Retry-After`) au lieu d'être mise en attente : une file d'attente
 * en mémoire garderait les connexions et les corps de requête ouverts, ce qui aggraverait le problème. Le compteur est
 * relâché à la fin de la réponse, y compris si le client coupe la connexion (événement `close`).
 *
 * @param max - Nombre maximal de requêtes simultanées (entier >= 1).
 * @returns Le middleware Express. Chaque appel de la fabrique a son propre compteur.
 */
export function createConcurrencyLimit(max: number): RequestHandler {
  let active = 0;
  return (_req, res, next) => {
    if (active >= max) {
      res.set("Retry-After", "1").status(503).json({ error: "ServerBusy", message: "Serveur occupé par d'autres traitements, réessayez dans un instant" });
      return;
    }
    active += 1;
    let released = false;
    const release = (): void => {
      if (!released) {
        released = true;
        active -= 1;
      }
    };
    res.once("close", release); // `close` est émis à la fin de la réponse OU si la connexion est coupée
    next();
  };
}
