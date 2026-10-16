/**
 * Tests de charge de l'API avec autocannon (phase 6).
 *
 * Outillage de développement (hors couches applicatives). Le script démarre l'API dans un process séparé, sur la base et le Redis
 * de TEST (jamais ceux de développement), crée un utilisateur et une image, enchaîne des scénarios, affiche un tableau, nettoie, puis
 * vérifie des seuils : code de sortie non nul si un scénario renvoie des erreurs 5xx inattendues.
 *
 * Usage : `npm run loadtest -w apps/api` (variables : LOADTEST_DURATION en secondes, LOADTEST_CONNECTIONS ; voir docs/LOAD_TESTING.md).
 */
import "dotenv/config";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import autocannon, { type Result } from "autocannon";
import { Redis } from "ioredis";
import pg from "pg";
import sharp from "sharp";

const PORT = 3090;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const DURATION = Number(process.env["LOADTEST_DURATION"] ?? 10);
const CONNECTIONS = Number(process.env["LOADTEST_CONNECTIONS"] ?? 20);
const PASSWORD = "motdepasse-de-charge";
const EMAIL = "loadtest@example.com";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`Variable ${name} requise (voir apps/api/.env)`);
  return value;
}

interface Scenario {
  readonly name: string;
  readonly description: string;
  readonly connections: number;
  /** Statuts attendus en plus du 2xx (ex. 503 quand on sature volontairement) ; tout autre statut >= 500 fait échouer le test. */
  readonly allowedStatuses?: readonly number[];
  readonly options: (ctx: Context) => autocannon.Options;
}

interface Context {
  readonly token: string;
  readonly imageId: string;
}

const auth = (ctx: Context): Record<string, string> => ({ authorization: `Bearer ${ctx.token}` });
const json = { "content-type": "application/json" };
/** Paramètres de transformation différents à chaque requête : aucune n'est servie par le cache (vrai traitement à chaque fois). */
const randomTransform = (): string => JSON.stringify({ rotate: Math.floor(Math.random() * 721) - 360, resize: { width: 200 + Math.floor(Math.random() * 1200) }, format: "webp" });

const SCENARIOS: readonly Scenario[] = [
  {
    name: "health",
    description: "GET /health (base + Redis), sans authentification : le plancher de l'API",
    connections: CONNECTIONS,
    options: () => ({ url: `${BASE}/health` }),
  },
  {
    name: "liste",
    description: "GET /images (authentifié : JWT + quota Redis + requête PostgreSQL)",
    connections: CONNECTIONS,
    options: (ctx) => ({ url: `${BASE}/images?limit=20`, headers: auth(ctx) }),
  },
  {
    name: "lecture-image",
    description: "GET /images/:id (authentifié, fichier envoyé en flux)",
    connections: CONNECTIONS,
    options: (ctx) => ({ url: `${BASE}/images/${ctx.imageId}`, headers: auth(ctx) }),
  },
  {
    name: "transform-cache-hit",
    description: "POST /images/:id/transform, MÊMES paramètres : servi par le cache Redis (200 HIT)",
    connections: CONNECTIONS,
    options: (ctx) => ({
      url: `${BASE}/images/${ctx.imageId}/transform`,
      method: "POST",
      headers: { ...auth(ctx), ...json },
      body: JSON.stringify({ rotate: 90, filter: "sepia", format: "webp" }),
    }),
  },
  {
    name: "transform-miss-sature",
    description: "POST /images/:id/transform, paramètres TOUS différents : vrai traitement sharp ; le plafond de concurrence répond 503",
    connections: CONNECTIONS,
    allowedStatuses: [503],
    options: (ctx) => ({
      url: `${BASE}/images/${ctx.imageId}/transform`,
      method: "POST",
      headers: { ...auth(ctx), ...json },
      requests: [{ setupRequest: (req: autocannon.Request) => ({ ...req, body: randomTransform() }) }],
    }),
  },
  {
    name: "creation-job",
    description: "POST /images/:id/jobs (écriture PostgreSQL + mise en file BullMQ, 202) ; AUCUN worker : mesure l'API seule",
    connections: CONNECTIONS,
    options: (ctx) => ({
      url: `${BASE}/images/${ctx.imageId}/jobs`,
      method: "POST",
      headers: { ...auth(ctx), ...json },
      requests: [{ setupRequest: (req: autocannon.Request) => ({ ...req, body: randomTransform() }) }],
    }),
  },
  {
    name: "login-argon2",
    description: "POST /login (argon2id : volontairement lent et gourmand en CPU), peu de connexions",
    connections: 4,
    options: () => ({ url: `${BASE}/login`, method: "POST", headers: json, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) }),
  },
];

/** Démarre l'API et attend qu'elle réponde. */
async function startApi(storageDir: string): Promise<ChildProcess> {
  const child = spawn("npx", ["tsx", "src/main.ts"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: requiredEnv("TEST_DATABASE_URL"),
      REDIS_URL: process.env["TEST_REDIS_URL"] ?? "redis://localhost:6380/1",
      STORAGE_DRIVER: "local",
      STORAGE_LOCAL_DIR: storageDir,
      // Quotas relevés : on mesure la capacité du serveur, pas le rate limiting (testé ailleurs). Le plafond de concurrence reste celui de la configuration.
      RATE_LIMIT_AUTH: "1000000",
      RATE_LIMIT_LOGIN_EMAIL: "1000000",
      RATE_LIMIT_UPLOAD: "1000000",
      RATE_LIMIT_TRANSFORM: "1000000",
      RATE_LIMIT_READ: "1000000",
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return child;
    } catch {
      // pas encore prêt
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  child.kill();
  throw new Error("L'API n'a pas démarré dans le délai");
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} → ${String(res.status)}`);
  return res.json();
}

/** Crée l'utilisateur de charge et son image (1600×1200, bruit : un vrai traitement, pas une image unie). */
async function prepare(): Promise<Context> {
  await postJson(`${BASE}/register`, { email: EMAIL, password: PASSWORD });
  const { token } = (await postJson(`${BASE}/login`, { email: EMAIL, password: PASSWORD })) as { token: string };
  const png = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: "gaussian", mean: 128, sigma: 40 } } }).png().toBuffer();
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(png)], { type: "image/png" }), "charge.png");
  const res = await fetch(`${BASE}/images`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  if (!res.ok) throw new Error(`upload → ${String(res.status)}`);
  return { token, imageId: ((await res.json()) as { id: string }).id };
}

/** Vide le Redis de TEST (jobs en file, caches, compteurs laissés par la charge). Refuse la base 0, qui est celle de développement. */
async function flushTestRedis(): Promise<void> {
  const url = process.env["TEST_REDIS_URL"] ?? "redis://localhost:6380/1";
  if (new URL(url).pathname.replace("/", "") === "" || new URL(url).pathname === "/0") {
    throw new Error("TEST_REDIS_URL doit désigner une base autre que 0 (ex. redis://localhost:6380/1)");
  }
  const redis = new Redis(url);
  try {
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}

async function cleanup(): Promise<void> {
  await flushTestRedis();
  const pool = new pg.Pool({ connectionString: requiredEnv("TEST_DATABASE_URL") });
  try {
    await pool.query("DELETE FROM users WHERE email = $1", [EMAIL]);
  } finally {
    await pool.end();
  }
}

interface Row {
  readonly name: string;
  readonly result: Result;
  readonly unexpected: number;
}

/** Compte les réponses dont le statut n'est ni 2xx ni dans la liste autorisée du scénario. */
function unexpectedErrors(result: Result, allowed: readonly number[]): number {
  let count = 0;
  for (const [status, stats] of Object.entries(result.statusCodeStats ?? {})) {
    const code = Number(status);
    if (code >= 400 && !allowed.includes(code)) count += stats.count ?? 0;
  }
  return count + result.errors + result.timeouts;
}

function print(rows: readonly Row[]): void {
  console.log(`\nDurée par scénario : ${String(DURATION)} s · connexions : ${String(CONNECTIONS)} (login : 4)\n`);
  console.log("| scénario | req/s | Mo/s | latence p50 | p97.5 | p99 | max | 2xx | autres statuts | erreurs inattendues |");
  console.log("|---|---:|---:|---:|---:|---:|---:|---:|---|---:|");
  for (const { name, result, unexpected } of rows) {
    const others = Object.entries(result.statusCodeStats ?? {})
      .filter(([status]) => !status.startsWith("2"))
      .map(([status, stats]) => `${status}×${String(stats.count ?? 0)}`)
      .join(" ");
    console.log(
      `| ${name} | ${String(Math.round(result.requests.average))} | ${(result.throughput.average / 1_048_576).toFixed(1)} | ${String(result.latency.p50)} ms | ${String(result.latency.p97_5)} ms | ${String(result.latency.p99)} ms | ${String(result.latency.max)} ms | ${String(result["2xx"])} | ${others === "" ? "-" : others} | ${String(unexpected)} |`,
    );
  }
}

async function main(): Promise<void> {
  const storageDir = await mkdtemp(path.join(os.tmpdir(), "loadtest-"));
  let api: ChildProcess | null = null;
  const rows: Row[] = [];
  try {
    await cleanup(); // au cas où un run précédent aurait été interrompu
    api = await startApi(storageDir);
    const ctx = await prepare();
    for (const scenario of SCENARIOS) {
      console.error(`→ ${scenario.name} : ${scenario.description}`);
      const result = await autocannon({ ...scenario.options(ctx), connections: scenario.connections, duration: DURATION });
      rows.push({ name: scenario.name, result, unexpected: unexpectedErrors(result, scenario.allowedStatuses ?? []) });
    }

    // Scénario combiné : l'API reste-t-elle réactive pendant que des traitements lourds occupent le CPU ?
    console.error("→ reactivite-sous-charge : /health pendant des transformations sharp saturées");
    const heavy = autocannon({ ...SCENARIOS[4]?.options(ctx), connections: CONNECTIONS, duration: DURATION } as autocannon.Options);
    const probe = await autocannon({ url: `${BASE}/health`, connections: 2, duration: DURATION });
    await heavy;
    rows.push({ name: "health-pendant-transformations", result: probe, unexpected: unexpectedErrors(probe, []) });

    print(rows);
  } finally {
    api?.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await cleanup().catch(() => undefined);
    await rm(storageDir, { recursive: true, force: true });
  }
  const failed = rows.filter((row) => row.unexpected > 0);
  if (failed.length > 0) {
    console.error(`\nÉCHEC : erreurs inattendues dans ${failed.map((row) => row.name).join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("\nOK : aucune erreur inattendue (les 503 du scénario saturé sont voulus).");
  }
}

await main();
