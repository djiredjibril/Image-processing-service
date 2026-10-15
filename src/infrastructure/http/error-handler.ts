/**
 * Middleware Express global pour les erreurs réellement inattendues (bug, panne).
 *
 * Couche : infrastructure (HTTP). Les erreurs métier ne passent PAS par ici :
 * elles sont renvoyées dans un `Result` et traduites ailleurs.
 */
import type { ErrorRequestHandler } from "express";

/** Erreurs de lecture du corps (JSON malformé, corps trop gros) : la faute vient du client. */
function asClientError(error: unknown): { status: number; code: string; message: string } | null {
  if (typeof error !== "object" || error === null || !("type" in error)) {
    return null;
  }
  switch (error.type) {
    case "entity.parse.failed":
      return { status: 400, code: "MalformedJson", message: "Corps JSON malformé" };
    case "entity.too.large":
      return { status: 413, code: "PayloadTooLarge", message: "Corps de requête trop volumineux" };
    default:
      return null;
  }
}

/**
 * Répond 400/413 pour une requête mal formée, sinon 500 sans divulguer de détail interne au client.
 *
 * Pourquoi : une stack trace ou un message SQL dans la réponse aiderait un attaquant.
 * Le détail est loggé côté serveur (jamais de secret, mot de passe ni JWT dans ces logs).
 */
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  const clientError = asClientError(error);
  if (clientError !== null) {
    res.status(clientError.status).json({ error: clientError.code, message: clientError.message });
    return;
  }
  console.error("Erreur inattendue :", error);
  res.status(500).json({ error: "Internal Server Error" });
};
