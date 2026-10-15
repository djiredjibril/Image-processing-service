/**
 * Traduction des erreurs HTTP de l'API en messages lisibles.
 *
 * Rôle : un seul endroit transforme une erreur technique en phrase pour l'utilisateur.
 */
import { HttpErrorResponse } from '@angular/common/http';

/** Forme des erreurs renvoyées par l'API : `{ error, message }`. */
interface ApiErrorBody {
  readonly message: string;
}

/** Type guard : le corps d'erreur contient-il un `message` texte ? */
function hasMessage(body: unknown): body is ApiErrorBody {
  return typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string';
}

/**
 * Produit un message d'erreur pour l'utilisateur.
 *
 * @param error - Erreur capturée (normalement une `HttpErrorResponse`).
 * @returns Le message de l'API s'il existe, sinon un message générique adapté (API injoignable, etc.).
 */
export function describeApiError(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) {
    return 'Une erreur inattendue est survenue.';
  }
  if (error.status === 0) {
    return "Impossible de joindre l'API. Est-elle démarrée ?";
  }
  const body: unknown = error.error;
  return hasMessage(body) ? body.message : `Erreur ${String(error.status)}.`;
}
