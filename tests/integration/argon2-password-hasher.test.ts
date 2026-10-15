/** Tests d'intégration du hasher argon2 (vraie bibliothèque native). */
import argon2 from "argon2";
import { describe, expect, it } from "vitest";
import { Argon2PasswordHasher } from "../../src/infrastructure/security/argon2-password-hasher.js";

describe("Argon2PasswordHasher", () => {
  const hasher = new Argon2PasswordHasher();

  it("produit un hash argon2id vérifiable, différent du clair", async () => {
    const hash = (await hasher.hash("motdepasse")).reveal();
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("motdepasse");
    expect(await argon2.verify(hash, "motdepasse")).toBe(true);
    expect(await argon2.verify(hash, "autre")).toBe(false);
  });

  it("sale le hash : deux appels donnent deux résultats différents", async () => {
    const [a, b] = await Promise.all([hasher.hash("motdepasse"), hasher.hash("motdepasse")]);
    expect(a.reveal()).not.toBe(b.reveal());
  });
});
