/** Tests unitaires du use case RegisterUser (fakes en mémoire, aucune DB ni argon2). */
import { beforeEach, describe, expect, it } from "vitest";
import { RegisterUser } from "../../../src/application/use-cases/register-user.js";
import { isErr, isOk } from "../../../src/domain/shared/result.js";
import { FakePasswordHasher } from "../../fakes/fake-password-hasher.js";
import { InMemoryUserRepository } from "../../fakes/in-memory-user-repository.js";

describe("RegisterUser", () => {
  let users: InMemoryUserRepository;
  let hasher: FakePasswordHasher;
  let useCase: RegisterUser;

  beforeEach(() => {
    users = new InMemoryUserRepository();
    hasher = new FakePasswordHasher();
    useCase = new RegisterUser(users, hasher);
  });

  it("crée l'utilisateur et ne renvoie que { id, email }", async () => {
    const result = await useCase.execute({ email: "Salut@Example.com", password: "motdepasse" });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(Object.keys(result.value).sort()).toEqual(["email", "id"]);
      expect(result.value.email).toBe("salut@example.com");
    }
    expect(users.users).toHaveLength(1);
    expect(users.users[0]?.passwordHash.reveal()).toBe("fake-hash:motdepasse");
  });

  it("refuse un e-mail invalide", async () => {
    const result = await useCase.execute({ email: "nope", password: "motdepasse" });
    expect(isErr(result) && result.error.kind).toBe("InvalidEmail");
    expect(users.users).toHaveLength(0);
  });

  it("refuse un mot de passe de 7 caractères SANS appeler le hasher", async () => {
    const result = await useCase.execute({ email: "a@b.co", password: "1234567" });
    expect(isErr(result) && result.error.kind).toBe("WeakPassword");
    expect(hasher.received).toHaveLength(0);
  });

  it("accepte un mot de passe de 8 caractères", async () => {
    expect(isOk(await useCase.execute({ email: "a@b.co", password: "12345678" }))).toBe(true);
  });

  it("refuse un e-mail déjà pris, même avec une autre casse", async () => {
    await useCase.execute({ email: "a@b.co", password: "motdepasse" });
    const result = await useCase.execute({ email: "A@B.CO", password: "autremotdepasse" });
    expect(isErr(result) && result.error.kind).toBe("EmailAlreadyUsed");
    expect(users.users).toHaveLength(1);
  });
});
