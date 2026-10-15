/**
 * Port `IImageProcessor` : lecture et (plus tard) traitement d'images.
 *
 * Couche : domaine (port). Implémentation : `SharpImageProcessor`. En phase 1, une seule
 * capacité : lire les métadonnées.
 */
import type { CorruptedImageError } from "../errors/image-errors.js";
import type { Result } from "../shared/result.js";

/** Métadonnées brutes telles que lues dans l'en-tête de l'image. */
export interface ImageMetadata {
  /** Nom du format détecté par le décodeur (ex. `jpeg`). */
  readonly format: string;
  readonly width: number;
  readonly height: number;
}

/**
 * Contrat du traitement d'images.
 */
export interface IImageProcessor {
  /**
   * Lit format et dimensions SANS décoder l'image entière (protection contre les
   * « decompression bombs » : seul l'en-tête est analysé).
   *
   * @param data - Contenu du fichier.
   * @returns `Ok(métadonnées)`, ou `Err(CorruptedImageError)` si l'image est illisible. Ne lève pas pour un fichier invalide.
   */
  readMetadata(data: Uint8Array): Promise<Result<ImageMetadata, CorruptedImageError>>;
}
