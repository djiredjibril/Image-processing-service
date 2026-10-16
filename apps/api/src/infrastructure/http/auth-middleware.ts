/**
 * Middleware d'authentification par jeton Bearer.
 *
 * Couche : infrastructure (HTTP). Les routes protégées le placent avant leur handler
 * et lisent l'identité via `req.auth`. L'identité vit dans la requête, jamais dans la
 * mémoire du process (API stateless).
 */
import type { RequestHandler } from "express";
import type { AuthIdentity, ITokenService } from "../../domain/ports/token-service.js";

declare module "express-serve-static-core" {
  interface Request {
    /** Identité de l'appelant, présente seulement après le middleware d'authentification. */
    auth?: AuthIdentity;
  }
}

/**
 * Construit le middleware qui exige un jeton valide.
 *
 * @param tokens - Service de vérification des jetons.
 * @returns Un middleware : 401 si l'en-tête `Authorization: Bearer <jeton>` est absent ou
 * invalide, sinon renseigne `req.auth` et passe à la suite. Le jeton n'est jamais loggé.
 */
export function createAuthMiddleware(tokens: ITokenService): RequestHandler {
  return async (req, res, next) => {
    const header = req.header("authorization");
    const match = header === undefined ? null : /^Bearer (\S+)$/.exec(header);
    const identity = match?.[1] === undefined ? null : await tokens.verify(match[1]);

    if (identity === null) {
      res.set("WWW-Authenticate", "Bearer").status(401).json({ error: "Unauthorized", message: "Jeton absent ou invalide" });
      return;
    }
    req.auth = identity;
    next();
  };
}
