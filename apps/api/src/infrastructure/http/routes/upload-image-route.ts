/**
 * Route `POST /images` : upload d'une image (multipart, champ `image`).
 *
 * Couche : infrastructure (HTTP). Authentifie, reçoit le fichier en mémoire (borné par la
 * limite de poids), appelle le use case, traduit le `Result`. Aucune logique métier ici.
 */
import type { RequestHandler } from "express";
import { Router } from "express";
import multer from "multer";
import { isErr } from "../../../application/shared/result.js";
import type { UploadImage } from "../../../application/use-cases/upload-image.js";
import { uploadErrorToHttp } from "../error-mapping.js";

/**
 * Construit le routeur d'upload.
 *
 * Le middleware d'authentification passe AVANT multer : un appelant non authentifié est
 * refusé sans que son fichier soit lu. Le nom de fichier envoyé par le client est ignoré.
 *
 * @param uploadImage - Use case injecté.
 * @param authenticate - Middleware d'authentification.
 * @param maxBytes - Poids maximal d'un fichier ; multer interrompt la lecture au-delà (413).
 * @returns Un routeur exposant `POST /images` (201, 400, 401, 413, 415).
 */
export function createUploadRouter(uploadImage: UploadImage, authenticate: RequestHandler, maxBytes: number): Router {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1, fields: 0 } });

  router.post("/images", authenticate, upload.single("image"), async (req, res) => {
    if (req.auth === undefined) {
      res.status(401).json({ error: "Unauthorized", message: "Jeton absent ou invalide" });
      return;
    }
    if (req.file === undefined) {
      res.status(400).json({ error: "MissingFile", message: "Champ multipart « image » manquant" });
      return;
    }

    const result = await uploadImage.execute({ ownerId: req.auth.userId, data: req.file.buffer });
    if (isErr(result)) {
      const { status, body } = uploadErrorToHttp(result.error);
      res.status(status).json(body);
      return;
    }
    res.status(201).json(result.value);
  });

  return router;
}
