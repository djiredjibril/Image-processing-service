/**
 * Création du pool de connexions PostgreSQL (driver natif `pg`).
 *
 * Couche : infrastructure. Le domaine ne sait pas que PostgreSQL existe.
 */
import pg from "pg";

/**
 * Crée un pool de connexions.
 *
 * Pourquoi un pool : ouvrir une connexion TCP + authentification à chaque requête
 * serait coûteux ; le pool réutilise des connexions déjà ouvertes.
 *
 * @param connectionString - URL de connexion (ex. `postgres://user:pwd@host:5432/db`).
 * @returns Un pool `pg` ; l'appelant doit appeler `pool.end()` à l'arrêt.
 */
export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString });
}
