/**
 * Composition root : seul endroit qui assemble les dépendances concrètes.
 *
 * Couche : point d'entrée. L'application refuse de démarrer si la config est invalide.
 */
import "dotenv/config";
import { isErr } from "./application/shared/result.js";
import { loadConfig } from "./infrastructure/config/config.js";
import { LoginUser } from "./application/use-cases/login-user.js";
import { RegisterUser } from "./application/use-cases/register-user.js";
import { createApp } from "./infrastructure/http/app.js";
import { createPool } from "./infrastructure/persistence/database.js";
import { PgUserRepository } from "./infrastructure/persistence/pg-user-repository.js";
import { JwtTokenService } from "./infrastructure/security/jwt-token-service.js";
import { Argon2PasswordHasher } from "./infrastructure/security/argon2-password-hasher.js";

const config = loadConfig(process.env);
if (isErr(config)) {
  console.error("Configuration invalide :\n" + config.error.map((line) => ` - ${line}`).join("\n"));
  process.exit(1);
}

const pool = createPool(config.value.DATABASE_URL);
const users = new PgUserRepository(pool);
const hasher = new Argon2PasswordHasher();
const tokens = new JwtTokenService(config.value.JWT_SECRET, config.value.JWT_EXPIRES_IN);
const app = createApp({
  pool,
  registerUser: new RegisterUser(users, hasher),
  loginUser: new LoginUser(users, hasher, tokens),
});

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
