/** Tests des délais de protection du serveur HTTP : un client lent (« slowloris ») est déconnecté. */
import http from "node:http";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { configureServerTimeouts, DEFAULT_SERVER_TIMEOUTS } from "../../src/infrastructure/http/server-timeouts.js";

describe("configureServerTimeouts", () => {
  it("applique les délais, et garde headersTimeout supérieur à keepAliveTimeout", () => {
    const server = http.createServer();
    configureServerTimeouts(server, { headersTimeoutMs: 1000, requestTimeoutMs: 2000, keepAliveTimeoutMs: 5000 });
    expect(server.requestTimeout).toBe(2000);
    expect(server.keepAliveTimeout).toBe(5000);
    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
    server.close();
  });

  it("a des valeurs par défaut bornées (jamais « sans limite »)", () => {
    expect(DEFAULT_SERVER_TIMEOUTS.requestTimeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_SERVER_TIMEOUTS.headersTimeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_SERVER_TIMEOUTS.keepAliveTimeoutMs).toBeGreaterThan(0);
  });

  /** Ouvre une connexion, envoie `first` puis `drip` toutes les 100 ms, et renvoie au bout de combien de ms le serveur la coupe. */
  async function dripUntilClosed(timeouts: Parameters<typeof configureServerTimeouts>[1], first: string, drip: string): Promise<number> {
    // `connectionsCheckingInterval` : Node vérifie les délais périodiquement (30 s par défaut) ; on le raccourcit pour le test.
    const server = http.createServer({ connectionsCheckingInterval: 100 }, (_req, res) => {
      res.end("ok");
    });
    configureServerTimeouts(server, timeouts);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    try {
      const closedAfterMs = await new Promise<number>((resolve, reject) => {
        const started = Date.now();
        const socket = net.connect(port, "127.0.0.1");
        socket.write(first);
        const timer = setInterval(() => socket.write(drip), 100);
        socket.on("close", () => {
          clearInterval(timer);
          resolve(Date.now() - started);
        });
        socket.on("error", () => undefined);
        setTimeout(() => {
          clearInterval(timer);
          socket.destroy();
          reject(new Error("le serveur n'a pas coupé le client lent"));
        }, 7000);
      });
      const normal = await fetch(`http://127.0.0.1:${String(port)}/`);
      expect(await normal.text()).toBe("ok"); // un client normal reste servi
      return closedAfterMs;
    } finally {
      server.close();
    }
  }

  it("headersTimeout : un client qui envoie les EN-TÊTES goutte à goutte (slowloris) est déconnecté", async () => {
    const closedAfterMs = await dripUntilClosed(
      { headersTimeoutMs: 1500, requestTimeoutMs: 30_000, keepAliveTimeoutMs: 100 },
      "GET / HTTP/1.1\r\nHost: x\r\n", // en-têtes jamais terminés
      "X-A: b\r\n",
    );
    expect(closedAfterMs).toBeGreaterThan(1000); // pas coupé trop tôt
    expect(closedAfterMs).toBeLessThan(4500); // mais bien avant les délais par défaut de Node
  }, 10_000);

  it("requestTimeout : un client qui envoie le CORPS goutte à goutte est déconnecté", async () => {
    const closedAfterMs = await dripUntilClosed(
      { headersTimeoutMs: 1200, requestTimeoutMs: 1500, keepAliveTimeoutMs: 100 },
      "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 100000\r\n\r\n", // en-têtes complets, corps annoncé énorme
      "x",
    );
    expect(closedAfterMs).toBeGreaterThan(1000);
    expect(closedAfterMs).toBeLessThan(4500);
  }, 10_000);
});
