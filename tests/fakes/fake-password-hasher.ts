/** Fake de `IPasswordHasher` : hash prévisible, et trace des appels. */
import type { IPasswordHasher } from "../../src/domain/ports/password-hasher.js";
import { PasswordHash } from "../../src/domain/value-objects/password-hash.js";

/** Hasher factice qui enregistre les mots de passe reçus. */
export class FakePasswordHasher implements IPasswordHasher {
  readonly received: string[] = [];

  hash(plain: string): Promise<PasswordHash> {
    this.received.push(plain);
    return Promise.resolve(PasswordHash.fromHash(`fake-hash:${plain}`));
  }
}
