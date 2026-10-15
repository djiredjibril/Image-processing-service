/**
 * Route `POST /login`.
 *
 * Couche : infrastructure (HTTP). Valide l'entrée (zod), appelle le use case, traduit le
 * `Result`. Aucune logique métier ici.
 */
import { Router } from "express";
import { isErr } from "../../../application/shared/result.js";
import type { LoginUser } from "../../../application/use-cases/login-user.js";
import { loginErrorToHttp } from "../error-mapping.js";
import { loginBodySchema } from "../schemas/login-schema.js";

/**
 * Construit le routeur de connexion.
 *
 * @param loginUser - Use case injecté.
 * @returns Un routeur exposant `POST /login` (200 `{ token }`, 400, 401).
 */
export function createLoginRouter(loginUser: LoginUser): Router {
  const router = Router();

  router.post("/login", async (req, res) => {
    const body = loginBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({
        error: "ValidationError",
        message: "Corps invalide : { email: string, password: string } attendu",
        details: body.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
      return;
    }

    const result = await loginUser.execute(body.data);
    if (isErr(result)) {
      const { status, body: errorBody } = loginErrorToHttp(result.error);
      res.status(status).json(errorBody);
      return;
    }
    res.status(200).json(result.value);
  });

  return router;
}
