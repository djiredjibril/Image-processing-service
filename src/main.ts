/**
 * Composition root : seul endroit qui assemble les dépendances concrètes.
 *
 * Couche : point d'entrée. L'application refuse de démarrer si la config est invalide.
 */
import "dotenv/config";
import { isErr } from "./application/shared/result.js";
import { loadConfig } from "./infrastructure/config/config.js";
import { createApp } from "./infrastructure/http/app.js";
import { createPool } from "./infrastructure/persistence/database.js";

const config = loadConfig(process.env);
if (isErr(config)) {
  console.error("Configuration invalide :\n" + config.error.map((line) => ` - ${line}`).join("\n"));
  process.exit(1);
}

const pool = createPool(config.value.DATABASE_URL);
const app = createApp({ pool });

const server = app.listen(config.value.PORT, () => {
  console.log(`Serveur démarré sur le port ${String(config.value.PORT)}`);
});

/** Arrêt propre : on ferme le serveur HTTP puis le pool de connexions. */
function shutdown(): void {
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
