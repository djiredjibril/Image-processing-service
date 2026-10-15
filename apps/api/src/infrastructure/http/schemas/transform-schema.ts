/**
 * Schéma zod du corps de `POST /images/:id/transform`.
 *
 * Couche : infrastructure (HTTP). Valide la FORME (types, champs inconnus refusés) ; les bornes et les
 * valeurs autorisées (angles, tailles, formats, filtres) sont imposées par les value objects du domaine.
 */
import { z } from "zod";

/** Corps attendu : toutes les clés sont optionnelles, les clés inconnues sont refusées. */
export const transformBodySchema = z.strictObject({
  crop: z.strictObject({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
  rotate: z.number().optional(),
  flip: z.boolean().optional(),
  mirror: z.boolean().optional(),
  resize: z.strictObject({ width: z.number().optional(), height: z.number().optional(), fit: z.string().optional() }).optional(),
  filter: z.string().optional(),
  watermark: z.strictObject({ text: z.string(), position: z.string().optional(), opacity: z.number().optional() }).optional(),
  format: z.string().optional(),
  quality: z.number().optional(),
});
