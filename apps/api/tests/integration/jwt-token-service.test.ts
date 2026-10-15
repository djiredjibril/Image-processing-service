/** Tests d'intégration de JwtTokenService (vraie bibliothèque jose). */
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { JwtTokenService } from "../../src/infrastructure/security/jwt-token-service.js";

const SECRET = "un-secret-de-test-un-secret-de-test-12";
const key = new TextEncoder().encode(SECRET);

describe("JwtTokenService", () => {
  const service = new JwtTokenService(SECRET, "1h");

  it("signe puis vérifie : on retrouve l'identifiant utilisateur", async () => {
    const token = await service.sign({ userId: "user-1" });
    expect(await service.verify(token)).toEqual({ userId: "user-1" });
  });

  it("refuse un jeton signé avec un autre secret", async () => {
    const other = new JwtTokenService("un-autre-secret-un-autre-secret-123", "1h");
    expect(await service.verify(await other.sign({ userId: "user-1" }))).toBeNull();
  });

  it("refuse un jeton falsifié (charge utile modifiée)", async () => {
    const [header, , signature] = (await service.sign({ userId: "user-1" })).split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ sub: "admin", exp: 9999999999 })).toString("base64url");
    expect(await service.verify(`${header ?? ""}.${forgedPayload}.${signature ?? ""}`)).toBeNull();
  });

  it("refuse un jeton expiré", async () => {
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    expect(await service.verify(expired)).toBeNull();
  });

  it("refuse un jeton sans date d'expiration ou sans sujet", async () => {
    const noExp = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("user-1").sign(key);
    const noSub = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(key);
    expect(await service.verify(noExp)).toBeNull();
    expect(await service.verify(noSub)).toBeNull();
  });

  it("refuse alg: none et les chaînes qui ne sont pas des JWT", async () => {
    const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from('{"sub":"x","exp":9999999999}').toString("base64url")}.`;
    expect(await service.verify(none)).toBeNull();
    expect(await service.verify("n'importe quoi")).toBeNull();
    expect(await service.verify("")).toBeNull();
  });
});
