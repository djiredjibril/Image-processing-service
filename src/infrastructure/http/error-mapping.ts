/**
 * Traduction unique des erreurs métier en réponses HTTP.
 *
 * Couche : infrastructure (HTTP). Un seul endroit décide quel code HTTP correspond à
 * quelle erreur du domaine : les routes et les use cases l'ignorent.
 */
import type { InvalidCredentialsError } from "../../domain/errors/user-errors.js";
import type { RegisterUserError } from "../../application/use-cases/register-user.js";

/** Réponse HTTP d'erreur : statut + corps JSON. */
export interface HttpError {
  readonly status: number;
  readonly body: { readonly error: string; readonly message: string };
}

/**
 * Convertit une erreur de `RegisterUser` en réponse HTTP.
 *
 * @param error - Erreur métier renvoyée par le use case.
 * @returns Le statut (400 ou 409) et un corps `{ error, message }` sans donnée sensible.
 */
export function registerErrorToHttp(error: RegisterUserError): HttpError {
  switch (error.kind) {
    case "InvalidEmail":
      return { status: 400, body: { error: error.kind, message: `E-mail invalide : ${error.reason}` } };
    case "WeakPassword":
      return { status: 400, body: { error: error.kind, message: `Mot de passe trop faible : ${error.reason}` } };
    case "EmailAlreadyUsed":
      return { status: 409, body: { error: error.kind, message: "Un compte existe déjà avec cet e-mail" } };
  }
}

/**
 * Convertit l'erreur de `LoginUser` en réponse HTTP.
 *
 * @param error - Erreur métier renvoyée par le use case.
 * @returns Toujours 401 avec un message volontairement vague (pas d'indice sur le compte).
 */
export function loginErrorToHttp(error: InvalidCredentialsError): HttpError {
  return { status: 401, body: { error: error.kind, message: "E-mail ou mot de passe incorrect" } };
}
