/**
 * Modèles des données d'images échangées avec l'API.
 *
 * Rôle : décrire le contrat JSON de `POST /images` et `GET /images`.
 */

/** Métadonnées publiques d'une image (jamais la clé de stockage interne). */
export interface ImageSummary {
  readonly id: string;
  readonly format: 'jpeg' | 'png' | 'webp';
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
  /** Date ISO 8601. */
  readonly createdAt: string;
}

/** Page de résultats de `GET /images`. */
export interface ImagePage {
  readonly items: readonly ImageSummary[];
  readonly page: number;
  readonly limit: number;
  /** Nombre total d'images de l'utilisateur (sert à calculer le nombre de pages). */
  readonly total: number;
}
