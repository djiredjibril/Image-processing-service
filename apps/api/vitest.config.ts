/**
 * Configuration Vitest (outillage de test, hors couches applicatives).
 *
 * Les fichiers de test s'exécutent un par un : les tests d'intégration et E2E
 * partagent la même base `imageservice_test` et ne doivent pas se marcher dessus.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
  },
});
