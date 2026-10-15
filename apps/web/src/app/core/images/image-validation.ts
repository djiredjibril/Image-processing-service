/**
 * Pré-contrôle d'un fichier image côté navigateur.
 *
 * Rôle : donner un retour immédiat avant l'envoi. Ce n'est PAS une protection : l'API vérifie
 * elle-même le vrai type (magic bytes), le poids et les dimensions.
 */

/** Poids maximal accepté par l'API par défaut (`MAX_UPLOAD_BYTES`). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Types MIME déclarés acceptés. */
export const ACCEPTED_MIME_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Vérifie rapidement un fichier choisi.
 *
 * @param file - Fichier sélectionné (seuls `size` et `type` sont lus).
 * @returns Un message d'erreur, ou `null` si le fichier semble acceptable.
 */
export function validateImageFile(file: Pick<File, 'size' | 'type'>): string | null {
  if (file.size === 0) {
    return 'Le fichier est vide.';
  }
  if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
    return 'Format non supporté : choisissez une image JPEG, PNG ou WebP.';
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return 'Fichier trop lourd : 10 Mo maximum.';
  }
  return null;
}
