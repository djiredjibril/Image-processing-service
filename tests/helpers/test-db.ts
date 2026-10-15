/** Aides de test : pool vers `imageservice_test`, migré et nettoyable. */
import "dotenv/config";
import path from "node:path";
import type pg from "pg";
import { createPool } from "../../src/infrastructure/persistence/database.js";
import { runMigrations } from "../../src/infrastructure/persistence/migrator.js";

/** Renvoie l'URL de la base de test, ou lève une erreur claire si elle manque. */
export function testDatabaseUrl(): string {
  const url = process.env["TEST_DATABASE_URL"];
  if (url === undefined) {
    throw new Error("TEST_DATABASE_URL manquante (copier .env.example vers .env)");
  }
  return url;
}

/** Crée un pool vers la base de test et applique les vraies migrations du projet. */
export async function createMigratedTestPool(): Promise<pg.Pool> {
  const pool = createPool(testDatabaseUrl());
  await runMigrations(pool, path.resolve("db/migrations"));
  return pool;
}

/** Vide les tables métier entre deux tests (CASCADE pour les futures clés étrangères). */
export async function resetTables(pool: pg.Pool): Promise<void> {
  await pool.query("TRUNCATE users CASCADE");
}
