/** Tests du plafond de concurrence (petite app Express, aucune dépendance externe). */
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createConcurrencyLimit } from "../../../src/infrastructure/http/concurrency-limit-middleware.js";

/** App dont le handler reste en attente tant qu'on ne libère pas la « porte ». */
function gatedApp(max: number): { app: express.Express; open: () => void; entered: () => number } {
  let entered = 0;
  const waiting: (() => void)[] = [];
  const app = express();
  app.get("/slow", createConcurrencyLimit(max), (_req, res) => {
    entered += 1;
    waiting.push(() => {
      res.json({ ok: true });
    });
  });
  return {
    app,
    entered: () => entered,
    open: () => {
      while (waiting.length > 0) waiting.shift()?.();
    },
  };
}

async function until(condition: () => boolean): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > 3000) throw new Error("condition non atteinte");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("createConcurrencyLimit", () => {
  it("refuse tout de suite (503 + Retry-After) la requête au-delà du plafond, sans la mettre en attente", async () => {
    const { app, open, entered } = gatedApp(2);
    const first = request(app).get("/slow").then((res) => res);
    const second = request(app).get("/slow").then((res) => res);
    await until(() => entered() === 2);

    const refused = await request(app).get("/slow");
    expect(refused.status).toBe(503);
    expect(refused.body).toMatchObject({ error: "ServerBusy" });
    expect(refused.headers["retry-after"]).toBe("1");
    expect(entered()).toBe(2); // le handler n'a pas été exécuté pour la requête refusée

    open();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
  });

  it("libère la place à la fin de la réponse : une nouvelle requête passe ensuite", async () => {
    const { app, open, entered } = gatedApp(1);
    const first = request(app).get("/slow").then((res) => res);
    await until(() => entered() === 1);
    open();
    await first;

    const next = request(app).get("/slow").then((res) => res);
    await until(() => entered() === 2);
    open();
    expect((await next).status).toBe(200);
  });

  it("libère aussi la place si le client COUPE la connexion en cours de traitement", async () => {
    const { app, entered, open } = gatedApp(1);
    const server = app.listen(0);
    try {
      const { port } = server.address() as { port: number };
      const controller = new AbortController();
      const aborted = fetch(`http://127.0.0.1:${String(port)}/slow`, { signal: controller.signal }).catch(() => "aborted");
      await until(() => entered() === 1);
      controller.abort();
      expect(await aborted).toBe("aborted");
      await new Promise((resolve) => setTimeout(resolve, 100)); // laisse Node émettre `close`

      const again = fetch(`http://127.0.0.1:${String(port)}/slow`);
      await until(() => entered() === 2); // sans libération, celle-ci aurait reçu un 503 et n'entrerait jamais
      open();
      expect((await again).status).toBe(200);
    } finally {
      server.close();
    }
  });

  it("chaque instance a son propre compteur", async () => {
    const a = gatedApp(1);
    const b = gatedApp(1);
    const first = request(a.app).get("/slow").then((res) => res);
    await until(() => a.entered() === 1);
    const other = request(b.app).get("/slow").then((res) => res);
    await until(() => b.entered() === 1);
    a.open();
    b.open();
    expect((await first).status).toBe(200);
    expect((await other).status).toBe(200);
  });
});
