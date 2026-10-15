/**
 * Runner de migrations SQL maison.
 *
 * Couche : infrastructure (persistance). Exécute dans l'ordre les fichiers
 * `NNN_*.sql` d'un dossier et mémorise ceux déjà appliqués dans `schema_migrations`.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";

const MIGRATION_FILE = /^\d{3}_.+\.sql$/;

/**
 * Applique les migrations en attente.
 *
 * Garanties : ordre alphabétique (donc numérique grâce au préfixe `NNN`), idempotent
 * (une migration déjà enregistrée n'est jamais rejouée), et chaque migration est
 * exécutée dans une transaction : si un de ses ordres SQL échoue, rien n'est
 * appliqué ni enregistré. Le SQL est statique (lu depuis un fichier), jamais
 * construit à partir d'une entrée utilisateur.
 *
 * @param pool - Pool de connexions vers la base cible.
 * @param directory - Dossier contenant les fichiers de migration.
 * @returns Les noms des migrations appliquées pendant cet appel (vide si rien à faire).
 * @throws Si un fichier SQL est invalide : erreur d'infrastructure, la transaction est annulée.
 */
export async function runMigrations(pool: pg.Pool, directory: string): Promise<string[]> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );

  const applied = await pool.query<{ name: string }>("SELECT name FROM schema_migrations");
  const alreadyApplied = new Set(applied.rows.map((row) => row.name));

  const files = (await readdir(directory)).filter((file) => MIGRATION_FILE.test(file)).sort();
  const newlyApplied: string[] = [];

  for (const file of files) {
    if (alreadyApplied.has(file)) {
      continue;
    }
    const sql = await readFile(path.join(directory, file), "utf8");
    await applyOne(pool, file, sql);
    newlyApplied.push(file);
  }
  return newlyApplied;
}

/** Exécute une migration et l'enregistre dans une seule transaction. */
async function applyOne(pool: pg.Pool, name: string, sql: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
