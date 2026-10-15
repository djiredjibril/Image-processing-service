/**
 * Port `IImageProcessor` : lecture et transformation d'images.
 *
 * Couche : domaine (port). Implémentation : `SharpImageProcessor`.
 */
import type { CorruptedImageError } from "../errors/image-errors.js";
import type { Result } from "../shared/result.js";
import type { ImageFormat } from "../value-objects/image-format.js";
import type { TransformationSet } from "../value-objects/transformation-set.js";

/** Métadonnées brutes telles que lues dans l'en-tête de l'image. */
export interface ImageMetadata {
  /** Nom du format détecté par le décodeur (ex. `jpeg`). */
  readonly format: string;
  readonly width: number;
  readonly height: number;
}

/** Image produite par une transformation, avec ses métadonnées réelles. */
export interface TransformedImage {
  readonly data: Uint8Array;
  readonly format: ImageFormat;
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

  /**
   * Applique des transformations et encode le résultat. Ne modifie jamais `data`.
   *
   * Garanties de toute implémentation : respecter l'ordre documenté de `TransformationSet`
   * (orientation EXIF, crop, rotate, flip, mirror, resize, filtre, encodage), appliquer
   * l'orientation EXIF puis SUPPRIMER toutes les métadonnées (dont le GPS) du résultat.
   *
   * @param data - Contenu de l'image source.
   * @param transformations - Transformations déjà validées.
   * @param outputFormat - Format d'encodage du résultat.
   * @returns `Ok(image produite)`, ou `Err(CorruptedImageError)` si la source ne peut pas être décodée. Ne lève pas pour un fichier invalide.
   */
  transform(data: Uint8Array, transformations: TransformationSet, outputFormat: ImageFormat): Promise<Result<TransformedImage, CorruptedImageError>>;
}
