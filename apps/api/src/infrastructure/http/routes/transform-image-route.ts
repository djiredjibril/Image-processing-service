/**
 * Route `POST /images/:id/transform` : crée une image dérivée.
 *
 * Couche : infrastructure (HTTP). Valide l'entrée (zod), appelle le use case, traduit le `Result`.
 */
import type { RequestHandler } from "express";
import { Router } from "express";
import { z } from "zod";
import { isErr } from "../../../application/shared/result.js";
import type { TransformImage } from "../../../application/use-cases/transform-image.js";
import { getImageErrorToHttp, transformErrorToHttp } from "../error-mapping.js";
import { transformBodySchema } from "../schemas/transform-schema.js";

const idSchema = z.uuid();

/**
 * Construit le routeur de transformation.
 *
 * @param transformImage - Use case injecté.
 * @param authenticate - Middleware d'authentification.
 * @returns Un routeur exposant `POST /images/:id/transform` (201, 400, 401, 404).
 */
export function createTransformImageRouter(transformImage: TransformImage, authenticate: RequestHandler): Router {
  const router = Router();

  router.post("/images/:id/transform", authenticate, async (req, res) => {
    if (req.auth === undefined) {
      res.status(401).json({ error: "Unauthorized", message: "Jeton absent ou invalide" });
      return;
    }
    const id = idSchema.safeParse(req.params["id"]);
    if (!id.success) {
      // Un identifiant mal formé ne peut correspondre à rien : même 404 qu'une image inconnue.
      const { status, body } = getImageErrorToHttp();
      res.status(status).json(body);
      return;
    }
    const body = transformBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({
        error: "ValidationError",
        message: "Corps invalide : voir les paramètres de transformation autorisés",
        details: body.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
      return;
    }

    const result = await transformImage.execute({ ownerId: req.auth.userId, imageId: id.data, transformations: body.data });
    if (isErr(result)) {
      const { status, body: errorBody } = transformErrorToHttp(result.error);
      res.status(status).json(errorBody);
      return;
    }
    res.status(201).json(result.value);
  });

  return router;
}
