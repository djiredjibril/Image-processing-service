/**
 * Middleware de limitation de débit.
 *
 * Couche : infrastructure (HTTP). Traduit la décision d'un `IRateLimiter` en réponse HTTP : `429` avec
 * `Retry-After` si la limite est dépassée, et en-têtes `RateLimit-*` informatifs sinon.
 */
import { createHash } from "node:crypto";
import type { Request, RequestHandler } from "express";
import type { IRateLimiter, RateLimitPolicy } from "../../domain/ports/rate-limiter.js";

/** Règles de limitation de chaque palier de routes. */
export interface RateLimitsConfig {
  /** `/register` et `/login`, comptés par adresse IP (l'utilisateur n'est pas encore connu). */
  readonly auth: RateLimitPolicy;
  /** `/login`, compté par ADRESSE E-MAIL visée : freine le brute-force distribué sur un compte, quelle que soit l'IP. */
  readonly loginEmail: RateLimitPolicy;
  /** `POST /images`, compté par utilisateur. */
  readonly upload: RateLimitPolicy;
  /** `POST /images/:id/transform`, compté par utilisateur (opération la plus coûteuse). */
  readonly transform: RateLimitPolicy;
  /** `GET /images` et `GET /images/:id`, comptés par utilisateur (compteur commun). */
  readonly read: RateLimitPolicy;
}

/** En-têtes de réponse que le navigateur doit pouvoir lire (à déclarer dans `exposedHeaders` de CORS). */
export const RATE_LIMIT_EXPOSED_HEADERS = ["Retry-After", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"] as const;

/** Paramètres de `createRateLimitMiddleware`. */
export interface RateLimitMiddlewareOptions {
  readonly limiter: IRateLimiter;
  /** Nom du palier : sépare les compteurs (un même utilisateur a un compteur par palier). */
  readonly scope: string;
  readonly policy: RateLimitPolicy;
  /** Extrait l'identité à limiter ; `null` si elle est inconnue (la requête n'est alors pas comptée). */
  readonly identify: (req: Request) => string | null;
}

/**
 * Construit un middleware qui compte la requête puis la refuse (429) si la limite est dépassée.
 *
 * Fail-open : si le limiteur est indisponible, la requête passe sans en-têtes `RateLimit-*`.
 *
 * @param options - Limiteur, palier, règle et extraction de l'identité.
 * @returns Le middleware Express.
 */
export function createRateLimitMiddleware(options: RateLimitMiddlewareOptions): RequestHandler {
  return async (req, res, next) => {
    const identity = options.identify(req);
    if (identity === null) {
      next();
      return;
    }
    const decision = await options.limiter.consume(`${options.scope}:${identity}`, options.policy);
    if (decision === null) {
      next();
      return;
    }
    res.set({
      "RateLimit-Limit": String(decision.limit),
      "RateLimit-Remaining": String(decision.remaining),
      "RateLimit-Reset": String(decision.resetSeconds),
    });
    if (!decision.allowed) {
      res
        .set("Retry-After", String(decision.resetSeconds))
        .status(429)
        .json({ error: "TooManyRequests", message: `Trop de requêtes : réessayez dans ${String(decision.resetSeconds)} s` });
      return;
    }
    next();
  };
}

/** Identité = adresse IP de l'appelant (paliers sans utilisateur connu). */
export const byIp = (req: Request): string | null => req.ip ?? null;

/**
 * Identité = adresse e-mail du corps de la requête (normalisée), sous forme d'EMPREINTE.
 *
 * L'empreinte (SHA-256, tronquée) évite de stocker des adresses e-mail en clair dans les clés Redis (donnée personnelle visible
 * par quiconque peut lister les clés). La normalisation (espaces, minuscules) empêche de contourner la limite avec `A@x.com`.
 * À placer APRÈS `express.json()` ; sans e-mail exploitable (corps invalide), la requête n'est pas comptée ici (le 400 suffit).
 */
export const byEmail = (req: Request): string | null => {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  if (typeof email !== "string" || email.length === 0 || email.length > 254) return null;
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);
};

/** Identité = utilisateur authentifié (à placer APRÈS le middleware d'authentification). */
export const byUser = (req: Request): string | null => req.auth?.userId ?? null;

/**
 * Enchaîne deux middlewares en un seul : le second ne s'exécute que si le premier a appelé `next()`.
 *
 * Sert à insérer la limitation juste après l'authentification sans modifier la signature des routes.
 *
 * @param first - Exécuté en premier (ex. l'authentification, qui peut répondre 401).
 * @param second - Exécuté ensuite (ex. la limitation par utilisateur).
 * @returns Un middleware unique.
 */
export function chain(first: RequestHandler, second: RequestHandler): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(first(req, res, (error?: unknown) => {
      if (error !== undefined) {
        next(error);
        return;
      }
      void Promise.resolve(second(req, res, next));
    }));
  };
}
