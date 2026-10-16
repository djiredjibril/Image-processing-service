/**
 * Route `POST /register`.
 *
 * Couche : infrastructure (HTTP). Valide l'entrée (zod), appelle le use case, traduit le
 * `Result` en réponse. Aucune logique métier ici.
 */
import { Router } from "express";
import { isErr } from "../../../application/shared/result.js";
import type { RegisterUser } from "../../../application/use-cases/register-user.js";
import { registerErrorToHttp } from "../error-mapping.js";
import { registerBodySchema } from "../schemas/register-schema.js";

/**
 * Construit le routeur de l'inscription.
 *
 * @param registerUser - Use case injecté.
 * @returns Un routeur exposant `POST /register` (201 `{ id, email }`, 400, 409).
 */
export function createRegisterRouter(registerUser: RegisterUser): Router {
  const router = Router();

  router.post("/register", async (req, res) => {
    const body = registerBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({
        error: "ValidationError",
        message: "Corps invalide : { email: string, password: string } attendu",
        details: body.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
      return;
    }

    const result = await registerUser.execute(body.data);
    if (isErr(result)) {
      const { status, body: errorBody } = registerErrorToHttp(result.error);
      res.status(status).json(errorBody);
      return;
    }
    res.status(201).json(result.value);
  });

  return router;
}
