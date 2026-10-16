/**
 * Route `GET /monitoring/overview` : photographie de Redis, de la file BullMQ, des compteurs et des jobs de l'appelant.
 *
 * Couche : infrastructure (HTTP). Alimente la page « Supervision » de l'application web (interrogée toutes les secondes).
 */
import type { RequestHandler } from "express";
import { Router } from "express";
import type { GetMonitoringOverview } from "../../../application/use-cases/get-monitoring-overview.js";

/**
 * Construit le routeur de supervision.
 *
 * @param getOverview - Use case injecté.
 * @param authenticate - Middleware d'authentification (et de limitation « lecture »).
 * @returns Un routeur exposant `GET /monitoring/overview` (200, 401, 429). Redis ou la file indisponibles : 200 avec `available: false`.
 */
export function createMonitoringRouter(getOverview: GetMonitoringOverview, authenticate: RequestHandler): Router {
  const router = Router();

  router.get("/monitoring/overview", authenticate, async (req, res) => {
    if (req.auth === undefined) {
      res.status(401).json({ error: "Unauthorized", message: "Jeton absent ou invalide" });
      return;
    }
    // Un instantané ne doit jamais être servi depuis un cache du navigateur ou d'un proxy.
    res.set("Cache-Control", "no-store").status(200).json(await getOverview.execute(req.auth.userId));
  });

  return router;
}
