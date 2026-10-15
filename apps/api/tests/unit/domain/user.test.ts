/** Tests unitaires de l'entité User. */
import { describe, expect, it } from "vitest";
import { User } from "../../../src/domain/entities/user.js";
import { isOk } from "../../../src/domain/shared/result.js";
import { Email } from "../../../src/domain/value-objects/email.js";
import { PasswordHash } from "../../../src/domain/value-objects/password-hash.js";

describe("User", () => {
  const email = Email.create("a@b.co");
  const passwordHash = PasswordHash.fromHash("h");

  it("create() génère un id unique et une date", () => {
    if (!isOk(email)) throw new Error("email de test invalide");
    const first = User.create({ email: email.value, passwordHash });
    const second = User.create({ email: email.value, passwordHash });
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.id).not.toBe(second.id);
    expect(first.createdAt).toBeInstanceOf(Date);
  });

  it("restore() reprend les données telles quelles", () => {
    if (!isOk(email)) throw new Error("email de test invalide");
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const user = User.restore({ id: "id-1", email: email.value, passwordHash, createdAt });
    expect(user.id).toBe("id-1");
    expect(user.createdAt).toBe(createdAt);
  });
});
