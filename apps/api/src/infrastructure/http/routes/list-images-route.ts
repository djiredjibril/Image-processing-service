/**
 * Route `GET /images?page=&limit=` : liste paginée des images de l'appelant.
 *
 * Couche : infrastructure (HTTP). Valide la query (zod), appelle le use case, traduit le `Result`.
 */
import type { RequestHandler } from "express";
import { Router } from "express";
import { isErr } from "../../../application/shared/result.js";
import type { ListImages } from "../../../application/use-cases/list-images.js";
import { listImagesErrorToHttp } from "../error-mapping.js";
import { listImagesQuerySchema } from "../schemas/list-images-schema.js";

/**
 * Construit le routeur de liste.
 *
 * @param listImages - Use case injecté.
 * @param authenticate - Middleware d'authentification.
 * @returns Un routeur exposant `GET /images` (200 `{ items, page, limit, total }`, 400, 401).
 */
export function createListImagesRouter(listImages: ListImages, authenticate: RequestHandler): Router {
  const router = Router();

  router.get("/images", authenticate, async (req, res) => {
    if (req.auth === undefined) {
      res.status(401).json({ error: "Unauthorized", message: "Jeton absent ou invalide" });
      return;
    }
    const query = listImagesQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({
        error: "ValidationError",
        message: "Paramètres invalides : page et limit doivent être des nombres",
        details: query.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
      return;
    }

    const result = await listImages.execute({ ownerId: req.auth.userId, ...query.data });
    if (isErr(result)) {
      const { status, body } = listImagesErrorToHttp(result.error);
      res.status(status).json(body);
      return;
    }
    res.status(200).json(result.value);
  });

  return router;
}
