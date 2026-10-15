/**
 * Script en ligne de commande : `npm run migrate` applique les migrations sur la base de dev.
 *
 * Couche : infrastructure (point d'entrée outillage).
 */
import "dotenv/config";
import path from "node:path";
import { isErr } from "../../application/shared/result.js";
import { loadConfig } from "../config/config.js";
import { createPool } from "./database.js";
import { runMigrations } from "./migrator.js";

const config = loadConfig(process.env);
if (isErr(config)) {
  console.error("Configuration invalide :\n" + config.error.map((line) => ` - ${line}`).join("\n"));
  process.exit(1);
}

const pool = createPool(config.value.DATABASE_URL);
try {
  const applied = await runMigrations(pool, path.resolve("db/migrations"));
  console.log(applied.length === 0 ? "Aucune migration à appliquer." : `Migrations appliquées : ${applied.join(", ")}`);
} finally {
  await pool.end();
}
