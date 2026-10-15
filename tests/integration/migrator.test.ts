/** Test d'intégration du migrator contre la base `imageservice_test`. */
import "dotenv/config";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../../src/infrastructure/persistence/database.js";
import { runMigrations } from "../../src/infrastructure/persistence/migrator.js";

const databaseUrl = process.env["TEST_DATABASE_URL"];
if (databaseUrl === undefined) {
  throw new Error("TEST_DATABASE_URL manquante (copier .env.example vers .env)");
}
const pool = createPool(databaseUrl);
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "migrations-"));
});

beforeEach(async () => {
  await pool.query("DROP TABLE IF EXISTS schema_migrations, test_a, test_b CASCADE");
});

afterAll(async () => {
  await pool.query("DROP TABLE IF EXISTS schema_migrations, test_a, test_b CASCADE");
  await pool.end();
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
