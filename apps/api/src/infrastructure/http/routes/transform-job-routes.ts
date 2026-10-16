/**
 * Routes des jobs de transformation asynchrone : `POST /images/:id/jobs` et `GET /jobs/:id`.
 *
 * Couche : infrastructure (HTTP). Valide l'entrée (zod), appelle les use cases, traduit les `Result`.
 */
import type { RequestHandler } from "express";
import { Router } from "express";
import { z } from "zod";
import { isErr } from "../../../application/shared/result.js";
import type { EnqueueTransformJob } from "../../../application/use-cases/enqueue-transform-job.js";
import type { GetJob } from "../../../application/use-cases/get-job.js";
import { enqueueErrorToHttp, getImageErrorToHttp, getJobErrorToHttp } from "../error-mapping.js";
import { transformBodySchema } from "../schemas/transform-schema.js";

const idSchema = z.uuid();

/** Délai conseillé au client avant son premier appel de statut, en secondes. */
const POLL_HINT_SECONDS = 1;

/**
 * Construit le routeur des jobs.
 *
 * @param enqueue - Use case de création de job.
 * @param getJob - Use case de consultation de job.
 * @param authenticateForCreate - Authentification (+ limitation) de la création.
 * @param authenticateForRead - Authentification (+ limitation) de la consultation.
 * @returns Un routeur exposant `POST /images/:id/jobs` (202, 400, 401, 404, 429, 503) et `GET /jobs/:id` (200, 401, 404, 429).
 */
export function createTransformJobRouter(
  enqueue: EnqueueTransformJob,
  getJob: GetJob,
  authenticateForCreate: RequestHandler,
  authenticateForRead: RequestHandler,
): Router {
  const router = Router();

  router.post("/images/:id/jobs", authenticateForCreate, async (req, res) => {
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
    const body = transformBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({
        error: "ValidationError",
        message: "Corps invalide : voir les paramètres de transformation autorisés",
        details: body.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
      return;
    }

    const result = await enqueue.execute({ ownerId: req.auth.userId, imageId: id.data, transformations: body.data });
    if (isErr(result)) {
      const { status, body: errorBody } = enqueueErrorToHttp(result.error);
      res.status(status).json(errorBody);
      return;
    }
    // 202 Accepted : la demande est acceptée mais PAS encore traitée. `Location` indique où suivre le job.
    res.status(202).set({ Location: `/jobs/${result.value.id}`, "Retry-After": String(POLL_HINT_SECONDS) }).json(result.value);
  });

  router.get("/jobs/:id", authenticateForRead, async (req, res) => {
    if (req.auth === undefined) {
      res.status(401).json({ error: "Unauthorized", message: "Jeton absent ou invalide" });
      return;
    }
    const id = idSchema.safeParse(req.params["id"]);
    if (!id.success) {
      const { status, body } = getJobErrorToHttp();
      res.status(status).json(body);
      return;
    }
    const result = await getJob.execute({ ownerId: req.auth.userId, jobId: id.data });
    if (isErr(result)) {
      const { status, body } = getJobErrorToHttp();
      res.status(status).json(body);
      return;
    }
    res.status(200).json(result.value);
  });

  return router;
}
