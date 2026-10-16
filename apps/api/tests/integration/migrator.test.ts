/** Test d'intégration du migrator contre la base `imageservice_test`. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../../src/infrastructure/persistence/database.js";
import { runMigrations } from "../../src/infrastructure/persistence/migrator.js";
import { testDatabaseUrl } from "../helpers/test-db.js";

// Schéma dédié : le test de migrator ne doit jamais toucher aux vraies tables du projet
// (schema_migrations, users) partagées avec les autres tests d'intégration.
const SCHEMA = "migrator_test";
const adminPool = createPool(testDatabaseUrl());
const pool = new pg.Pool({ connectionString: testDatabaseUrl(), options: `-c search_path=${SCHEMA}` });
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "migrations-"));
});

beforeEach(async () => {
  await adminPool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await adminPool.query(`CREATE SCHEMA ${SCHEMA}`);
});

afterAll(async () => {
  await adminPool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.end();
  await adminPool.end();
  await rm(dir, { recursive: true, force: true });
});

describe("runMigrations", () => {
  it("applique les fichiers dans l'ordre, puis ne rejoue rien", async () => {
    await writeFile(path.join(dir, "002_b.sql"), "CREATE TABLE test_b (id int);");
    await writeFile(path.join(dir, "001_a.sql"), "CREATE TABLE test_a (id int);");

    expect(await runMigrations(pool, dir)).toEqual(["001_a.sql", "002_b.sql"]);
    expect(await runMigrations(pool, dir)).toEqual([]);

    const rows = await pool.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name");
    expect(rows.rows.map((r) => r.name)).toEqual(["001_a.sql", "002_b.sql"]);
  });

  it("annule toute la migration si un ordre SQL échoue (transaction)", async () => {
    await rm(path.join(dir, "002_b.sql"), { force: true });
    await rm(path.join(dir, "001_a.sql"), { force: true });
    await writeFile(path.join(dir, "003_bad.sql"), "CREATE TABLE test_a (id int); SELECT * FROM table_inexistante;");

    await expect(runMigrations(pool, dir)).rejects.toThrow();

    const table = await pool.query("SELECT to_regclass('test_a') AS t");
    expect((table.rows[0] as { t: string | null }).t).toBeNull();
    const rows = await pool.query("SELECT 1 FROM schema_migrations");
    expect(rows.rowCount).toBe(0);
    await rm(path.join(dir, "003_bad.sql"));
  });
});
