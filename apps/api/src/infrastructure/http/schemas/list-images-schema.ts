/**
 * Schéma zod de la query string de `GET /images`.
 *
 * Couche : infrastructure (HTTP). Convertit `page` et `limit` (chaînes) en nombres avec
 * leurs valeurs par défaut ; les bornes sont ensuite imposées par le value object `Pagination`.
 */
import { z } from "zod";
import { Pagination } from "../../../domain/value-objects/pagination.js";

/** Query attendue : `?page=&limit=`, tous deux optionnels. */
export const listImagesQuerySchema = z.object({
  page: z.coerce.number().default(Pagination.DEFAULT_PAGE),
  limit: z.coerce.number().default(Pagination.DEFAULT_LIMIT),
});
