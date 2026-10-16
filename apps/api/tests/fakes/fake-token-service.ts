/** Fake de `ITokenService` : jeton prévisible `token-for:<userId>`. */
import type { AuthIdentity, ITokenService } from "../../src/domain/ports/token-service.js";

/** Service de jetons factice pour les tests unitaires. */
export class FakeTokenService implements ITokenService {
  sign(identity: AuthIdentity): Promise<string> {
    return Promise.resolve(`token-for:${identity.userId}`);
  }

  verify(token: string): Promise<AuthIdentity | null> {
    return Promise.resolve(token.startsWith("token-for:") ? { userId: token.slice("token-for:".length) } : null);
  }
}
