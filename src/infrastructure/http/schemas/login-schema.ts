/**
 * Schéma zod du corps de `POST /login`.
 *
 * Couche : infrastructure (HTTP). Valide uniquement la forme (deux chaînes).
 */
import { z } from "zod";

/** Corps attendu : deux chaînes. */
export const loginBodySchema = z.object({
  email: z.string(),
  password: z.string(),
});
