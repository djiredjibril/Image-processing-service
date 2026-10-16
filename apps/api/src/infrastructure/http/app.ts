/**
 * Fabrique de l'application Express.
 *
 * Couche : infrastructure (HTTP). Elle reçoit ses dépendances en paramètre
 * (pas de singleton) pour que les tests E2E puissent injecter la base de test.
 */
import cors from "cors";
import helmet from "helmet";
import express, { type Express } from "express";
import type { Redis } from "ioredis";
import type pg from "pg";
import type { EnqueueTransformJob } from "../../application/use-cases/enqueue-transform-job.js";
import type { GetImageUrl } from "../../application/use-cases/get-image-url.js";
import type { GetImage } from "../../application/use-cases/get-image.js";
import type { GetJob } from "../../application/use-cases/get-job.js";
import type { ListImages } from "../../application/use-cases/list-images.js";
import type { LoginUser } from "../../application/use-cases/login-user.js";
import type { RegisterUser } from "../../application/use-cases/register-user.js";
import type { TransformImage } from "../../application/use-cases/transform-image.js";
import type { UploadImage } from "../../application/use-cases/upload-image.js";
import type { IRateLimiter } from "../../domain/ports/rate-limiter.js";
import type { ITokenService } from "../../domain/ports/token-service.js";
import { createAuthMiddleware } from "./auth-middleware.js";
import { isRedisUp } from "../cache/redis-client.js";
import { errorHandler } from "./error-handler.js";
import { createConcurrencyLimit } from "./concurrency-limit-middleware.js";
import { byEmail, byIp, byUser, chain, createRateLimitMiddleware, RATE_LIMIT_EXPOSED_HEADERS, type RateLimitsConfig } from "./rate-limit-middleware.js";
import { createGetImageUrlRouter } from "./routes/get-image-url-route.js";
import { createGetImageRouter } from "./routes/get-image-route.js";
import { createListImagesRouter } from "./routes/list-images-route.js";
import { createLoginRouter } from "./routes/login-route.js";
import { createRegisterRouter } from "./routes/register-route.js";
import { createTransformJobRouter } from "./routes/transform-job-routes.js";
import { createTransformImageRouter } from "./routes/transform-image-route.js";
import { createUploadRouter } from "./routes/upload-image-route.js";

/** Dépendances nécessaires à la construction de l'application HTTP. */
export interface AppDependencies {
  readonly pool: pg.Pool;
  /** Client Redis (cache et rate limiting) : sa panne dégrade le service sans l'interrompre. */
  readonly redis: Redis;
  readonly registerUser: RegisterUser;
  readonly loginUser: LoginUser;
  readonly uploadImage: UploadImage;
  readonly getImage: GetImage;
  readonly listImages: ListImages;
  readonly transformImage: TransformImage;
  /** Création d'un job de transformation traité en arrière-plan. */
  readonly enqueueTransformJob: EnqueueTransformJob;
  /** Consultation du statut d'un job. */
  readonly getJob: GetJob;
  /** Délivrance d'URLs de lecture signées (stockage S3). */
  readonly getImageUrl: GetImageUrl;
  readonly tokens: ITokenService;
  /** Limiteur de débit (fail-open : sa panne ne bloque jamais les requêtes). */
  readonly rateLimiter: IRateLimiter;
  /** Règles de limitation par palier. */
  readonly rateLimits: RateLimitsConfig;
  readonly maxUploadBytes: number;
  /** Unique origine navigateur autorisée à appeler l'API (CORS). */
  readonly corsOrigin: string;
  /** Nombre de reverse proxies de confiance devant l'API (0 = aucun) : détermine `req.ip`, donc le palier `auth`. */
  readonly trustProxyHops: number;
  /** Transformations synchrones simultanées autorisées dans ce process (protège la RAM). */
  readonly maxConcurrentTransforms: number;
}

/**
 * Construit l'application Express (sans la démarrer).
 *
 * Séparer « construire » de « écouter sur un port » permet à `supertest`
 * de tester l'app sans ouvrir de port réseau.
 *
 * @param deps - Dépendances injectées par la composition root.
 * @returns L'application Express prête à être servie.
 */
export function createApp(deps: AppDependencies): Express {
  const app = express();
  // Ne jamais faire confiance à `X-Forwarded-For` par défaut : un client pourrait y mettre n'importe quelle IP pour contourner le
  // palier `auth`. On ne lit cet en-tête qu'à travers le nombre EXACT de proxies de confiance déclaré par la configuration.
  app.set("trust proxy", deps.trustProxyHops);
  // En-têtes de sécurité (X-Content-Type-Options: nosniff, pas de X-Powered-By, etc.). `same-site` : l'app web, sur une autre origine
  // du même site (ex. :4200 et :3000), peut charger les images ; un autre site, non.
  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
  // CORS en tout premier : une requête « preflight » (OPTIONS) n'a pas d'en-tête Authorization
  // et doit être acceptée avant l'authentification. Une SEULE origine est autorisée (jamais `*`).
  // Pas de `credentials` : l'API s'authentifie par jeton Bearer, pas par cookie.
  app.use(
    cors({
      // Comparaison stricte : seule l'origine exacte reçoit des en-têtes CORS, toute autre n'en reçoit aucun.
      origin: (origin, callback) => {
        callback(null, origin === deps.corsOrigin);
      },
      methods: ["GET", "POST"],
      allowedHeaders: ["Authorization", "Content-Type"],
      // En-têtes de réponse lisibles par le JavaScript du navigateur (les autres sont masqués par CORS).
      exposedHeaders: ["X-Cache", ...RATE_LIMIT_EXPOSED_HEADERS],
      maxAge: 600,
    }),
  );
  // Limite la taille du corps JSON : protège la mémoire contre les envois démesurés.
  app.use(express.json({ limit: "100kb" }));

  // PostgreSQL est indispensable (503 s'il tombe) ; Redis est une optimisation : sa panne donne 200 « degraded ».
  app.get("/health", async (_req, res) => {
    const redis = (await isRedisUp(deps.redis)) ? "up" : "down";
    try {
      await deps.pool.query("SELECT 1");
      res.status(200).json({ status: redis === "up" ? "ok" : "degraded", database: "up", redis });
    } catch (error) {
      // Panne d'infrastructure : on répond 503 explicite plutôt qu'un 500 générique.
      console.error("Health check : base injoignable", error);
      res.status(503).json({ status: "error", database: "down", redis });
    }
  });

  // Un palier = un compteur par identité. Inscription et connexion partagent le palier « auth », compté par IP
  // (l'utilisateur n'est pas connu) : cela freine le brute-force et la création de comptes en masse.
  const limit = (scope: keyof RateLimitsConfig, identify: typeof byIp): ReturnType<typeof createRateLimitMiddleware> =>
    createRateLimitMiddleware({ limiter: deps.rateLimiter, scope, policy: deps.rateLimits[scope], identify });
  const authLimiter = limit("auth", byIp);
  app.post("/register", authLimiter);
  app.post("/login", authLimiter, limit("loginEmail", byEmail));
  app.use(createRegisterRouter(deps.registerUser));
  app.use(createLoginRouter(deps.loginUser));

  // Paliers par utilisateur : la limitation vient APRÈS l'authentification (il faut connaître l'utilisateur),
  // mais avant tout traitement coûteux (lecture du fichier envoyé, sharp).
  const authenticate = createAuthMiddleware(deps.tokens);
  const readAuth = chain(authenticate, limit("read", byUser));
  app.use(createUploadRouter(deps.uploadImage, chain(authenticate, limit("upload", byUser)), deps.maxUploadBytes));
  app.use(createGetImageRouter(deps.getImage, readAuth));
  app.use(createGetImageUrlRouter(deps.getImageUrl, readAuth));
  app.use(createListImagesRouter(deps.listImages, readAuth));
  // Créer un job coûte autant (en quota) qu'une transformation synchrone ; le suivi (polling) est une lecture.
  const transformAuth = chain(authenticate, limit("transform", byUser));
  // Plafond de concurrence APRÈS l'authentification et le quota : on ne refuse pas pour « serveur occupé » un appelant non autorisé.
  app.use(createTransformImageRouter(deps.transformImage, chain(transformAuth, createConcurrencyLimit(deps.maxConcurrentTransforms))));
  app.use(createTransformJobRouter(deps.enqueueTransformJob, deps.getJob, transformAuth, readAuth));

  // Route inconnue : JSON, comme le reste de l'API (le HTML par défaut d'Express révèle le framework).
  app.use((_req, res) => {
    res.status(404).json({ error: "NotFound", message: "Route introuvable" });
  });
  app.use(errorHandler);
  return app;
}
