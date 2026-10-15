/** Tests E2E du middleware d'authentification sur une route protégée de test. */
import express from "express";
import request from "supertest";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { createAuthMiddleware } from "../../src/infrastructure/http/auth-middleware.js";
import { JwtTokenService } from "../../src/infrastructure/security/jwt-token-service.js";
import { TEST_JWT_SECRET } from "../helpers/build-test-app.js";

const tokens = new JwtTokenService(TEST_JWT_SECRET, "1h");
const app = express();
app.get("/protected", createAuthMiddleware(tokens), (req, res) => {
  res.json({ userId: req.auth?.userId });
});

describe("middleware d'authentification", () => {
  it("laisse passer un jeton valide et expose l'identité", async () => {
    const token = await tokens.sign({ userId: "user-42" });
    const res = await request(app).get("/protected").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: "user-42" });
  });

  it("401 sans en-tête Authorization, avec WWW-Authenticate", async () => {
    const res = await request(app).get("/protected");
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBe("Bearer");
  });

  it("401 pour un schéma incorrect, un jeton invalide ou expiré", async () => {
    const token = await tokens.sign({ userId: "user-42" });
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-42")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(TEST_JWT_SECRET));

    expect((await request(app).get("/protected").set("Authorization", `Basic ${token}`)).status).toBe(401);
    expect((await request(app).get("/protected").set("Authorization", token)).status).toBe(401);
    expect((await request(app).get("/protected").set("Authorization", "Bearer pas.un.jwt")).status).toBe(401);
    expect((await request(app).get("/protected").set("Authorization", `Bearer ${expired}`)).status).toBe(401);
  });
});
