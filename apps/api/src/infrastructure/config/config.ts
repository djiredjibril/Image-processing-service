/**
 * Lecture et validation des variables d'environnement avec zod.
 *
 * Couche : infrastructure. Le reste de l'application reçoit un objet `Config`
 * typé et ne lit jamais `process.env` directement.
 */
import { z } from "zod";
import { err, ok, type Result } from "../../application/shared/result.js";

/** Vrai si la chaîne est exactement une origine (`schéma://hôte[:port]`), sans chemin ni `/` final. */
function isPlainOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

const configSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET doit faire au moins 32 caractères"),
  JWT_EXPIRES_IN: z
    .string()
    .regex(/^\d+[smhdw]$/, "JWT_EXPIRES_IN doit ressembler à 30m, 1h, 7d")
    .default("1h"),
  // Base 0 en développement ; les tests utilisent TEST_REDIS_URL (base 1) pour ne jamais toucher aux données de dev.
  REDIS_URL: z.string().min(1).default("redis://localhost:6380/0"),
  CORS_ORIGIN: z
    .string()
    .refine(isPlainOrigin, "CORS_ORIGIN doit être une origine exacte, ex. http://localhost:4200 (sans chemin, sans / final, sans *)")
    .default("http://localhost:4200"),
  STORAGE_DRIVER: z.literal("local").default("local"),
  STORAGE_LOCAL_DIR: z.string().min(1).default("storage"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10_485_760),
  MAX_IMAGE_PIXELS_SIDE: z.coerce.number().int().positive().default(8000),
});

/** Configuration validée de l'application (immuable, entièrement typée). */
export type Config = Readonly<z.infer<typeof configSchema>>;

/**
 * Valide un objet de variables d'environnement.
 *
 * Pourquoi un `Result` plutôt qu'un `throw` : la validation est testable sans
 * process qui plante, et c'est `main.ts` qui décide d'arrêter l'application.
 *
 * @param env - Variables brutes (typiquement `process.env`).
 * @returns `Ok(Config)` si tout est valide, sinon `Err` avec la liste des problèmes lisibles.
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): Result<Config, string[]> {
  const parsed = configSchema.safeParse(env);
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
}
