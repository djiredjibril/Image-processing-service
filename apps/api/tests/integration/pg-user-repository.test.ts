/** Tests d'intégration de PgUserRepository contre `imageservice_test`. */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { User } from "../../src/domain/entities/user.js";
import { isErr, isOk } from "../../src/domain/shared/result.js";
import { Email } from "../../src/domain/value-objects/email.js";
import { PasswordHash } from "../../src/domain/value-objects/password-hash.js";
import { PgUserRepository } from "../../src/infrastructure/persistence/pg-user-repository.js";
import { createMigratedTestPool, resetTables } from "../helpers/test-db.js";

let pool: pg.Pool;
let repository: PgUserRepository;

function newUser(rawEmail: string): User {
  const email = Email.create(rawEmail);
  if (!isOk(email)) throw new Error("email de test invalide");
  return User.create({ email: email.value, passwordHash: PasswordHash.fromHash("hash-bidon") });
}

beforeAll(async () => {
  pool = await createMigratedTestPool();
  repository = new PgUserRepository(pool);
});
beforeEach(async () => {
  await resetTables(pool);
});
afterAll(async () => {
  await pool.end();
});

describe("PgUserRepository", () => {
  it("save puis findByEmail restitue le même utilisateur", async () => {
    const user = newUser("a@b.co");
    expect(isOk(await repository.save(user))).toBe(true);

    const found = await repository.findByEmail(user.email);
    expect(found?.id).toBe(user.id);
    expect(found?.email.value).toBe("a@b.co");
    expect(found?.passwordHash.reveal()).toBe("hash-bidon");
  });

  it("findByEmail renvoie null si introuvable", async () => {
    const email = Email.create("inconnu@b.co");
    if (!isOk(email)) throw new Error("email de test invalide");
    expect(await repository.findByEmail(email.value)).toBeNull();
  });

  it("traduit la violation d'unicité en EmailAlreadyUsed", async () => {
    await repository.save(newUser("a@b.co"));
    const second = await repository.save(newUser("a@b.co"));
    expect(isErr(second) && second.error.kind).toBe("EmailAlreadyUsed");
  });

  it("garantit l'unicité même pour deux sauvegardes concurrentes", async () => {
    const results = await Promise.all([repository.save(newUser("c@d.co")), repository.save(newUser("c@d.co"))]);
    expect(results.filter(isOk)).toHaveLength(1);
    expect(results.filter(isErr)).toHaveLength(1);
  });
});
