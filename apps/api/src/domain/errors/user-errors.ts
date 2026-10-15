/**
 * Erreurs métier typées liées aux utilisateurs.
 *
 * Couche : domaine. Ce sont des valeurs (pas des exceptions) renvoyées dans un `Result` ;
 * le champ `kind` permet de les distinguer exhaustivement (`switch`) et de les traduire
 * en codes HTTP en un seul endroit, côté infrastructure.
 */

/** L'adresse e-mail fournie n'est pas valide. */
export class InvalidEmailError {
  readonly kind = "InvalidEmail" as const;

  constructor(public readonly reason: string) {}
}

/** Le mot de passe ne respecte pas les règles minimales de robustesse. */
export class WeakPasswordError {
  readonly kind = "WeakPassword" as const;

  constructor(public readonly reason: string) {}
}

/** Un compte existe déjà avec cette adresse e-mail. */
export class EmailAlreadyUsedError {
  readonly kind = "EmailAlreadyUsed" as const;
}

/**
 * Identifiants incorrects.
 *
 * Volontairement UNIQUE pour « e-mail inconnu » et « mauvais mot de passe » : deux erreurs
 * distinctes permettraient à un attaquant de savoir quels e-mails ont un compte (énumération).
 */
export class InvalidCredentialsError {
  readonly kind = "InvalidCredentials" as const;
}
