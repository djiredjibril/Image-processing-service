/**
 * Type `Result<T, E>` (Ok / Err) pour renvoyer des erreurs typées sans `throw`.
 *
 * Couche : domaine (partagé). Aucune dépendance externe. Défini ici (et non dans `application`)
 * car les value objects et les ports du domaine renvoient des `Result` : le domaine ne doit
 * jamais importer une couche extérieure. `application/shared/result.ts` le ré-exporte.
 */

/** Succès : porte la valeur produite. */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/** Échec : porte l'erreur métier typée. */
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/**
 * Résultat d'une opération qui peut échouer pour une raison métier prévisible.
 *
 * Pourquoi : le compilateur force l'appelant à traiter le cas d'erreur
 * (via `isOk` / `isErr`), ce qu'un `throw` ne garantit pas. `throw` reste
 * réservé aux erreurs inattendues (bug, panne d'infrastructure).
 */
export type Result<T, E> = Ok<T> | Err<E>;

/**
 * Construit un succès.
 *
 * @param value - Valeur produite.
 * @returns Un `Ok` portant la valeur.
 */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/**
 * Construit un échec.
 *
 * @param error - Erreur métier typée.
 * @returns Un `Err` portant l'erreur.
 */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/**
 * Type guard : affine un `Result` en `Ok`.
 *
 * @param result - Résultat à tester.
 * @returns `true` si c'est un succès (`result.value` devient accessible).
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/**
 * Type guard : affine un `Result` en `Err`.
 *
 * @param result - Résultat à tester.
 * @returns `true` si c'est un échec (`result.error` devient accessible).
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}
