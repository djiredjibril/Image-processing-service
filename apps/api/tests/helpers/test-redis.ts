/** Aides de test : client Redis vers la base de TEST (jamais celle de dev) et nettoyage. */
import "dotenv/config";
import type { Redis } from "ioredis";
import { createRedisClient, waitForRedis } from "../../src/infrastructure/cache/redis-client.js";

/** Renvoie l'URL de la base Redis de test (base 1 par défaut). */
export function testRedisUrl(): string {
  return process.env["TEST_REDIS_URL"] ?? "redis://localhost:6380/1";
}

/**
 * Vérifie qu'une URL Redis désigne une base DIFFÉRENTE de la base 0 (utilisée en développement).
 *
 * @param url - URL de connexion.
 * @returns `true` si le numéro de base est explicite et non nul.
 */
export function isNonDefaultDatabase(url: string): boolean {
  const database = new URL(url).pathname.replace("/", "");
  return database !== "" && database !== "0";
}

/** Crée un client Redis connecté à la base de test, et attend qu'il soit prêt (échoue clairement si Redis est absent). */
export async function createTestRedis(): Promise<Redis> {
  const client = createRedisClient(testRedisUrl());
  if (!(await waitForRedis(client, 3000))) {
    client.disconnect();
    throw new Error("Redis de test injoignable : lancer `docker compose up -d --wait` (port 6380)");
  }
  return client;
}

/**
 * Vide la base de test. Refuse de s'exécuter si l'URL pointe vers la base 0 (dev) : on ne
 * supprime jamais des données de développement par erreur de configuration.
 */
export async function flushTestRedis(redis: Redis): Promise<void> {
  if (!isNonDefaultDatabase(testRedisUrl())) {
    throw new Error("TEST_REDIS_URL doit désigner une base autre que 0 (ex. redis://localhost:6380/1)");
  }
  await redis.flushdb();
}
