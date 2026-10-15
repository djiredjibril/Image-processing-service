/** Tests unitaires du value object PasswordHash. */
import { describe, expect, it } from "vitest";
import { PasswordHash } from "../../../src/domain/value-objects/password-hash.js";

describe("PasswordHash", () => {
  it("refuse un hash vide", () => {
    expect(() => PasswordHash.fromHash("")).toThrow();
  });

  it("donne accès à la valeur via reveal()", () => {
    expect(PasswordHash.fromHash("abc").reveal()).toBe("abc");
  });

  it("ne fuit jamais le hash en sérialisation JSON ou texte", () => {
    const hash = PasswordHash.fromHash("secret-hash");
    expect(JSON.stringify({ hash })).not.toContain("secret-hash");
    expect(String(hash)).not.toContain("secret-hash");
  });
});
