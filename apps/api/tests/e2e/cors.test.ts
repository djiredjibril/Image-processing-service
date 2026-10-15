/** Tests E2E de la configuration CORS : une seule origine autorisée, preflight sans authentification. */
import type pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";
import { createMigratedTestPool } from "../helpers/test-db.js";

const ALLOWED = "http://localhost:4200";
let pool: pg.Pool;
let app: ReturnType<typeof buildTestApp>;

beforeAll(async () => {
  pool = await createMigratedTestPool();
  app = buildTestApp(pool, { corsOrigin: ALLOWED });
});
afterAll(async () => {
  await pool.end();
});

describe("CORS", () => {
  it("preflight d'une origine autorisée : 204 SANS jeton, avec méthodes et en-têtes permis", async () => {
    const res = await request(app)
      .options("/images")
      .set("Origin", ALLOWED)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "authorization,content-type");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(res.headers["access-control-allow-methods"]).toBe("GET,POST");
    expect(res.headers["access-control-allow-headers"]).toBe("Authorization,Content-Type");
    expect(res.headers["access-control-max-age"]).toBe("600");
  });

  it("n'autorise ni les cookies (credentials) ni le joker *", async () => {
    const res = await request(app).get("/health").set("Origin", ALLOWED);
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(res.headers["access-control-allow-origin"]).not.toBe("*");
    expect(res.headers["vary"]).toContain("Origin");
  });

  it("requête réelle depuis l'origine autorisée : en-tête CORS présent, réponse normale", async () => {
    const res = await request(app).get("/health").set("Origin", ALLOWED);
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
  });

  it("origine inconnue : aucun en-tête Access-Control-Allow-Origin (le navigateur bloquera la réponse)", async () => {
    const preflight = await request(app)
      .options("/images")
      .set("Origin", "http://evil.example")
      .set("Access-Control-Request-Method", "POST");
    const real = await request(app).get("/health").set("Origin", "http://evil.example");

    expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
    expect(real.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("l'authentification reste exigée sur les vraies requêtes : CORS n'est pas une protection d'accès", async () => {
    const res = await request(app).get("/images").set("Origin", ALLOWED);
    expect(res.status).toBe(401);
  });
});
