/**
 * Traduction unique des erreurs métier en réponses HTTP.
 *
 * Couche : infrastructure (HTTP). Un seul endroit décide quel code HTTP correspond à
 * quelle erreur du domaine : les routes et les use cases l'ignorent.
 */
import type { InvalidCredentialsError } from "../../domain/errors/user-errors.js";
import type { UploadImageError } from "../../application/use-cases/upload-image.js";
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

/**
 * Convertit une erreur de `UploadImage` en réponse HTTP.
 *
 * @param error - Erreur métier renvoyée par le use case.
 * @returns 413 (poids ou dimensions), 415 (format), 400 (fichier vide ou illisible).
 */
export function uploadErrorToHttp(error: UploadImageError): HttpError {
  switch (error.kind) {
    case "FileTooLarge":
      return { status: 413, body: { error: error.kind, message: `Fichier trop lourd (maximum ${String(error.maxBytes)} octets)` } };
    case "ImageDimensionsTooLarge":
      return { status: 413, body: { error: error.kind, message: `Image trop grande (maximum ${String(error.maxSide)} px par côté)` } };
    case "UnsupportedImageFormat":
      return { status: 415, body: { error: error.kind, message: "Format non supporté : JPEG, PNG ou WebP attendu" } };
    case "EmptyFile":
      return { status: 400, body: { error: error.kind, message: "Fichier vide" } };
    case "CorruptedImage":
      return { status: 400, body: { error: error.kind, message: `Image illisible : ${error.reason}` } };
  }
}

/**
 * Réponse HTTP d'une image introuvable (inconnue OU appartenant à un autre utilisateur).
 *
 * @returns Toujours 404 avec le même corps : jamais 403, pour ne pas révéler l'existence d'une image.
 */
export function getImageErrorToHttp(): HttpError {
  return { status: 404, body: { error: "ImageNotFound", message: "Image introuvable" } };
}
