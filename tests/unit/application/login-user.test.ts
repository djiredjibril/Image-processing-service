/** Tests unitaires du use case LoginUser (fakes en mémoire). */
import { beforeEach, describe, expect, it } from "vitest";
import { LoginUser } from "../../../src/application/use-cases/login-user.js";
import { RegisterUser } from "../../../src/application/use-cases/register-user.js";
import { isErr, isOk } from "../../../src/domain/shared/result.js";
import { FakePasswordHasher } from "../../fakes/fake-password-hasher.js";
import { FakeTokenService } from "../../fakes/fake-token-service.js";
import { InMemoryUserRepository } from "../../fakes/in-memory-user-repository.js";

describe("LoginUser", () => {
  let hasher: FakePasswordHasher;
  let useCase: LoginUser;
  let userId: string;

  beforeEach(async () => {
    const users = new InMemoryUserRepository();
    hasher = new FakePasswordHasher();
    useCase = new LoginUser(users, hasher, new FakeTokenService());
    const registered = await new RegisterUser(users, hasher).execute({ email: "a@b.co", password: "motdepasse" });
    if (!isOk(registered)) throw new Error("inscription de test échouée");
    userId = registered.value.id;
  });

  it("renvoie un jeton pour des identifiants corrects (e-mail insensible à la casse)", async () => {
    const result = await useCase.execute({ email: "A@B.co", password: "motdepasse" });
    expect(isOk(result) && result.value.token).toBe(`token-for:${userId}`);
  });

  it("renvoie la MÊME erreur pour mauvais mot de passe, e-mail inconnu et e-mail invalide", async () => {
    const wrongPassword = await useCase.execute({ email: "a@b.co", password: "mauvais" });
    const unknownEmail = await useCase.execute({ email: "inconnu@b.co", password: "motdepasse" });
    const invalidEmail = await useCase.execute({ email: "pas-un-email", password: "motdepasse" });
    for (const result of [wrongPassword, unknownEmail, invalidEmail]) {
      expect(isErr(result) && result.error.kind).toBe("InvalidCredentials");
    }
    expect(wrongPassword).toEqual(unknownEmail);
    expect(unknownEmail).toEqual(invalidEmail);
  });

  it("vérifie quand même un hash factice si l'e-mail est inconnu (anti-timing)", async () => {
    const before = hasher.verified.length;
    await useCase.execute({ email: "inconnu@b.co", password: "x" });
    expect(hasher.verified.length).toBe(before + 1);
  });
});
