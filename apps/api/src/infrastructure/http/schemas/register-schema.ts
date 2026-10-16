/**
 * Schéma zod du corps de `POST /register`.
 *
 * Couche : infrastructure (HTTP). Valide la FORME (types) ; les règles métier
 * (format d'e-mail, longueur du mot de passe) restent dans le domaine / le use case.
 */
import { z } from "zod";

/** Corps attendu : deux chaînes. */
export const registerBodySchema = z.object({
  email: z.string(),
  password: z.string(),
});
