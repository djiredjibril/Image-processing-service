/** Fake en mémoire de `IUserRepository` pour les tests unitaires (aucune DB). */
import type { User } from "../../src/domain/entities/user.js";
import { EmailAlreadyUsedError } from "../../src/domain/errors/user-errors.js";
import type { IUserRepository } from "../../src/domain/repositories/user-repository.js";
import { err, ok, type Result } from "../../src/domain/shared/result.js";
import type { Email } from "../../src/domain/value-objects/email.js";

/** Repository en mémoire respectant le même contrat que l'implémentation pg. */
export class InMemoryUserRepository implements IUserRepository {
  readonly users: User[] = [];

  save(user: User): Promise<Result<void, EmailAlreadyUsedError>> {
    if (this.users.some((u) => u.email.value === user.email.value)) {
      return Promise.resolve(err(new EmailAlreadyUsedError()));
    }
    this.users.push(user);
    return Promise.resolve(ok(undefined));
  }

  findByEmail(email: Email): Promise<User | null> {
    return Promise.resolve(this.users.find((u) => u.email.value === email.value) ?? null);
  }
}
