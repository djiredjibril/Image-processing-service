/**
 * Fabrique de l'application Express.
 *
 * Couche : infrastructure (HTTP). Elle reçoit ses dépendances en paramètre
 * (pas de singleton) pour que les tests E2E puissent injecter la base de test.
 */
import cors from "cors";
import express, { type Express } from "express";
import type pg from "pg";
import type { GetImage } from "../../application/use-cases/get-image.js";
import type { ListImages } from "../../application/use-cases/list-images.js";
import type { LoginUser } from "../../application/use-cases/login-user.js";
import type { RegisterUser } from "../../application/use-cases/register-user.js";
import type { TransformImage } from "../../application/use-cases/transform-image.js";
import type { UploadImage } from "../../application/use-cases/upload-image.js";
import type { ITokenService } from "../../domain/ports/token-service.js";
import { createAuthMiddleware } from "./auth-middleware.js";
import { errorHandler } from "./error-handler.js";
import { createGetImageRouter } from "./routes/get-image-route.js";
import { createListImagesRouter } from "./routes/list-images-route.js";
import { createLoginRouter } from "./routes/login-route.js";
import { createRegisterRouter } from "./routes/register-route.js";
import { createTransformImageRouter } from "./routes/transform-image-route.js";
import { createUploadRouter } from "./routes/upload-image-route.js";

/** Dépendances nécessaires à la construction de l'application HTTP. */
export interface AppDependencies {
  readonly pool: pg.Pool;
  readonly registerUser: RegisterUser;
  readonly loginUser: LoginUser;
  readonly uploadImage: UploadImage;
  readonly getImage: GetImage;
  readonly listImages: ListImages;
  readonly transformImage: TransformImage;
  readonly tokens: ITokenService;
  readonly maxUploadBytes: number;
  /** Unique origine navigateur autorisée à appeler l'API (CORS). */
  readonly corsOrigin: string;
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
      maxAge: 600,
    }),
  );
  // Limite la taille du corps JSON : protège la mémoire contre les envois démesurés.
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", async (_req, res) => {
    try {
      await deps.pool.query("SELECT 1");
      res.status(200).json({ status: "ok", database: "up" });
    } catch (error) {
      // Panne d'infrastructure : on répond 503 explicite plutôt qu'un 500 générique.
      console.error("Health check : base injoignable", error);
      res.status(503).json({ status: "error", database: "down" });
    }
  });

  app.use(createRegisterRouter(deps.registerUser));
  app.use(createLoginRouter(deps.loginUser));
  const authenticate = createAuthMiddleware(deps.tokens);
  app.use(createUploadRouter(deps.uploadImage, authenticate, deps.maxUploadBytes));
  app.use(createGetImageRouter(deps.getImage, authenticate));
  app.use(createListImagesRouter(deps.listImages, authenticate));
  app.use(createTransformImageRouter(deps.transformImage, authenticate));

  app.use(errorHandler);
  return app;
}
