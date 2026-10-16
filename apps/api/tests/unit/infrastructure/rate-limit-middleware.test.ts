/** Tests du middleware de limitation (petite app Express, limiteur en mémoire, aucun réseau externe). */
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { chain, createRateLimitMiddleware } from "../../../src/infrastructure/http/rate-limit-middleware.js";
import { InMemoryRateLimiter, UnavailableRateLimiter } from "../../fakes/in-memory-rate-limiter.js";

const POLICY = { limit: 2, windowSeconds: 60 };

function appWith(limiter: InMemoryRateLimiter | UnavailableRateLimiter, identify: () => string | null = () => "someone") {
  const app = express();
  app.get("/x", createRateLimitMiddleware({ limiter, scope: "s", policy: POLICY, identify }), (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe("createRateLimitMiddleware", () => {
  it("laisse passer sous la limite avec les en-têtes RateLimit-* qui décroissent", async () => {
    const app = appWith(new InMemoryRateLimiter());
    const first = await request(app).get("/x");
    const second = await request(app).get("/x");
    expect(first.status).toBe(200);
    expect(first.headers["ratelimit-limit"]).toBe("2");
    expect(first.headers["ratelimit-remaining"]).toBe("1");
    expect(second.headers["ratelimit-remaining"]).toBe("0");
    expect(first.headers["retry-after"]).toBeUndefined();
  });

  it("répond 429 + Retry-After au-delà de la limite, sans exécuter le handler", async () => {
    const app = appWith(new InMemoryRateLimiter());
    await request(app).get("/x");
    await request(app).get("/x");
    const res = await request(app).get("/x");
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "TooManyRequests" });
    expect(Number(res.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(res.headers["ratelimit-remaining"]).toBe("0");
    expect(res.body).not.toHaveProperty("ok");
  });

  it("fail-open : limiteur indisponible → la requête passe, sans en-têtes RateLimit-*", async () => {
    const res = await request(appWith(new UnavailableRateLimiter())).get("/x");
    expect(res.status).toBe(200);
    expect(res.headers["ratelimit-limit"]).toBeUndefined();
  });

  it("identité inconnue : la requête n'est pas comptée", async () => {
    const app = appWith(new InMemoryRateLimiter(), () => null);
    for (let i = 0; i < 5; i++) expect((await request(app).get("/x")).status).toBe(200);
  });
});

describe("chain", () => {
  it("n'exécute pas le second middleware si le premier répond sans appeler next()", async () => {
    let secondRan = false;
    const app = express();
    app.get(
      "/x",
      chain(
        (_req, res) => {
          res.status(401).end();
        },
        (_req, _res, next) => {
          secondRan = true;
          next();
        },
      ),
      (_req, res) => {
        res.end();
      },
    );
    expect((await request(app).get("/x")).status).toBe(401);
    expect(secondRan).toBe(false);
  });
});
