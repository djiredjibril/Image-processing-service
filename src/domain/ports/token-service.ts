/**
 * Port `ITokenService` : émission et vérification des jetons d'authentification.
 *
 * Couche : domaine (port). L'implémentation concrète (JWT) vit en infrastructure.
 */

/** Identité portée par un jeton valide. */
export interface AuthIdentity {
  readonly userId: string;
}

/**
 * Contrat de gestion des jetons.
 *
 * Toute implémentation doit produire des jetons signés, à durée de vie limitée, et refuser
 * tout jeton falsifié, expiré ou mal formé.
 */
export interface ITokenService {
  /**
   * Émet un jeton pour un utilisateur.
   *
   * @param identity - Identité à inscrire dans le jeton.
   * @returns Le jeton signé (chaîne opaque pour le client).
   */
  sign(identity: AuthIdentity): Promise<string>;

  /**
   * Vérifie un jeton.
   *
   * @param token - Jeton reçu du client.
   * @returns L'identité si le jeton est valide, ou `null` s'il est invalide, falsifié ou
   * expiré. Ne lève jamais d'erreur pour un jeton invalide.
   */
  verify(token: string): Promise<AuthIdentity | null>;
}
