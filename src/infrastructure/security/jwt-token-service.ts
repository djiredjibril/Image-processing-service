/**
 * Implémentation JWT (HS256, bibliothèque `jose`) de `ITokenService`.
 *
 * Couche : infrastructure (sécurité).
 */
import { jwtVerify, SignJWT } from "jose";
import type { AuthIdentity, ITokenService } from "../../domain/ports/token-service.js";

/**
 * Jetons JWT signés en HMAC-SHA256. L'identifiant utilisateur est placé dans la
 * revendication standard `sub`.
 */
export class JwtTokenService implements ITokenService {
  private readonly key: Uint8Array;

  /**
   * Prépare la clé de signature à partir du secret de configuration.
   *
   * @param secret - Secret de signature (>= 32 caractères, validé par la config).
   * @param expiresIn - Durée de vie, ex. `1h`, `30m`, `7d`.
   */
  constructor(
    secret: string,
    private readonly expiresIn: string,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  /** Signe un jeton contenant `sub` = identifiant utilisateur, avec date d'émission et d'expiration. */
  async sign(identity: AuthIdentity): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(identity.userId)
      .setIssuedAt()
      .setExpirationTime(this.expiresIn)
      .sign(this.key);
  }

  /**
   * Vérifie signature, expiration et présence de `sub`. Seul HS256 est accepté : cela
   * bloque l'attaque classique `alg: none` ou le changement d'algorithme.
   */
  async verify(token: string): Promise<AuthIdentity | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"], requiredClaims: ["sub", "exp"] });
      return payload.sub === undefined ? null : { userId: payload.sub };
    } catch {
      // Jeton falsifié, expiré ou mal formé : pas une panne, simplement « invalide ».
      return null;
    }
  }
}
