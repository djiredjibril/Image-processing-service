/**
 * Middleware Express global pour les erreurs réellement inattendues (bug, panne).
 *
 * Couche : infrastructure (HTTP). Les erreurs métier ne passent PAS par ici :
 * elles sont renvoyées dans un `Result` et traduites ailleurs.
 */
import type { ErrorRequestHandler } from "express";

/**
 * Répond 500 sans divulguer de détail interne au client.
 *
 * Pourquoi : une stack trace ou un message SQL dans la réponse aiderait un attaquant.
 * Le détail est loggé côté serveur (jamais de secret, mot de passe ni JWT dans ces logs).
 */
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  console.error("Erreur inattendue :", error);
  res.status(500).json({ error: "Internal Server Error" });
};
