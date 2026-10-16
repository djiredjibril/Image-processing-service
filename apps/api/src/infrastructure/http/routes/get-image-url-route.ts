/**
 * Route `GET /images/:id/url` : délivre une URL signée et temporaire pour télécharger une image.
 *
 * Couche : infrastructure (HTTP). Valide l'entrée, appelle le use case, traduit le `Result`.
 */
import type { RequestHandler } from "express";
import { Router } from "express";
import { z } from "zod";
import { isErr } from "../../../application/shared/result.js";
import type { GetImageUrl } from "../../../application/use-cases/get-image-url.js";
import { getImageErrorToHttp, getImageUrlErrorToHttp } from "../error-mapping.js";

const idSchema = z.uuid();

/**
 * Construit le routeur de l'URL signée.
 *
 * @param getImageUrl - Use case injecté.
 * @param authenticate - Middleware d'authentification (et de limitation).
 * @returns Un routeur exposant `GET /images/:id/url` (200, 401, 404, 429, 501 si le stockage ne gère pas les URLs signées).
 */
export function createGetImageUrlRouter(getImageUrl: GetImageUrl, authenticate: RequestHandler): Router {
  const router = Router();

  router.get("/images/:id/url", authenticate, async (req, res) => {
    if (req.auth === undefined) {
      res.status(401).json({ error: "Unauthorized", message: "Jeton absent ou invalide" });
      return;
    }
    const id = idSchema.safeParse(req.params["id"]);
    if (!id.success) {
      const { status, body } = getImageErrorToHttp();
      res.status(status).json(body);
      return;
    }
    const result = await getImageUrl.execute({ ownerId: req.auth.userId, imageId: id.data });
    if (isErr(result)) {
      const { status, body } = getImageUrlErrorToHttp(result.error);
      res.status(status).json(body);
      return;
    }
    // Cette réponse contient une permission : elle ne doit être mise en cache ni par le navigateur ni par un proxy.
    res.set("Cache-Control", "no-store").status(200).json(result.value);
  });

  return router;
}
