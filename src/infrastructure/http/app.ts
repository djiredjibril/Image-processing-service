/**
 * Fabrique de l'application Express.
 *
 * Couche : infrastructure (HTTP). Elle reçoit ses dépendances en paramètre
 * (pas de singleton) pour que les tests E2E puissent injecter la base de test.
 */
import express, { type Express } from "express";
import type pg from "pg";
import type { RegisterUser } from "../../application/use-cases/register-user.js";
import { errorHandler } from "./error-handler.js";
import { createRegisterRouter } from "./routes/register-route.js";

/** Dépendances nécessaires à la construction de l'application HTTP. */
export interface AppDependencies {
  readonly pool: pg.Pool;
  readonly registerUser: RegisterUser;
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

  app.use(errorHandler);
  return app;
}
