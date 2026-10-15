/**
 * Route `GET /images/:id` : renvoie le fichier d'une image.
 *
 * Couche : infrastructure (HTTP). Le fichier est envoyé en flux (`pipeline`), sans être
 * chargé en mémoire. Aucune logique métier ici.
 */
import type { RequestHandler } from "express";
import { Router } from "express";
import { pipeline } from "node:stream";
import { z } from "zod";
import { isErr } from "../../../application/shared/result.js";
import type { GetImage } from "../../../application/use-cases/get-image.js";
import { getImageErrorToHttp } from "../error-mapping.js";

const idSchema = z.uuid();

/**
 * Construit le routeur de lecture d'image.
 *
 * @param getImage - Use case injecté.
 * @param authenticate - Middleware d'authentification.
 * @returns Un routeur exposant `GET /images/:id` (200 fichier, 401, 404).
 */
export function createGetImageRouter(getImage: GetImage, authenticate: RequestHandler): Router {
  const router = Router();

  router.get("/images/:id", authenticate, async (req, res) => {
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

    const result = await getImage.execute({ ownerId: req.auth.userId, imageId: id.data });
    if (isErr(result)) {
      const { status, body } = getImageErrorToHttp();
      res.status(status).json(body);
      return;
    }

    res.status(200);
    res.set({
      "Content-Type": result.value.mimeType,
      "Content-Length": String(result.value.sizeBytes),
      // Empêche le navigateur de « deviner » un autre type que celui déclaré.
      "X-Content-Type-Options": "nosniff",
    });
    pipeline(result.value.stream, res, (error) => {
      if (error) {
        // Les en-têtes sont déjà partis : on ne peut plus changer le statut, seulement couper.
        console.error("Erreur pendant l'envoi du fichier", error);
      }
    });
  });

  return router;
}
