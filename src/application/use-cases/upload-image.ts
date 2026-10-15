/**
 * Use case `UploadImage` : valider puis enregistrer une image originale.
 *
 * Couche : application.
 */
import { Image } from "../../domain/entities/image.js";
import {
  CorruptedImageError,
  type EmptyFileError,
  FileTooLargeError,
  ImageDimensionsTooLargeError,
  UnsupportedImageFormatError,
} from "../../domain/errors/image-errors.js";
import type { IFileStorage } from "../../domain/ports/file-storage.js";
import type { IImageProcessor } from "../../domain/ports/image-processor.js";
import type { IImageRepository } from "../../domain/repositories/image-repository.js";
import { FileSize } from "../../domain/value-objects/file-size.js";
import { ImageDimensions } from "../../domain/value-objects/image-dimensions.js";
import { ImageFormat } from "../../domain/value-objects/image-format.js";
import { StorageKey } from "../../domain/value-objects/storage-key.js";
import { err, isErr, ok, type Result } from "../shared/result.js";

/** Limites de validation, issues de la configuration. */
export interface UploadLimits {
  /** Poids maximal en octets (`MAX_UPLOAD_BYTES`). */
  readonly maxBytes: number;
  /** Taille maximale d'un côté en pixels (`MAX_IMAGE_PIXELS_SIDE`). */
  readonly maxPixelsSide: number;
}

/** Données d'entrée : le propriétaire et le contenu. Le nom du fichier client n'est volontairement PAS transmis. */
export interface UploadImageInput {
  readonly ownerId: string;
  readonly data: Uint8Array;
}

/** Métadonnées publiques de l'image créée (jamais la clé de stockage interne). */
export interface UploadImageOutput {
  readonly id: string;
  readonly format: string;
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
  readonly createdAt: Date;
}

/** Erreurs métier possibles de `UploadImage`. */
export type UploadImageError =
  | EmptyFileError
  | FileTooLargeError
  | UnsupportedImageFormatError
  | ImageDimensionsTooLargeError
  | CorruptedImageError;

/**
 * Valide et enregistre une image originale.
 *
 * Contrôles dans l'ordre du moins cher au plus cher : poids, type RÉEL (magic bytes),
 * puis métadonnées lues dans l'en-tête et dimensions maximales. Seule l'image qui passe
 * tout est écrite.
 */
export class UploadImage {
  constructor(
    private readonly storage: IFileStorage,
    private readonly processor: IImageProcessor,
    private readonly images: IImageRepository,
    private readonly limits: UploadLimits,
  ) {}

  /**
   * Exécute l'upload.
   *
   * Compensation : le fichier est écrit AVANT la ligne en base. Fichier et base n'ont pas de
   * transaction commune ; si l'insertion échoue, on supprime le fichier pour ne pas laisser
   * d'orphelin, puis on relance l'erreur d'origine.
   *
   * @param input - Propriétaire et contenu du fichier.
   * @returns `Ok(métadonnées)`, ou `Err` parmi : `EmptyFileError`, `FileTooLargeError`,
   * `UnsupportedImageFormatError`, `CorruptedImageError`, `ImageDimensionsTooLargeError`.
   * @throws Si le stockage ou la base tombent en panne (erreur inattendue).
   */
  async execute(input: UploadImageInput): Promise<Result<UploadImageOutput, UploadImageError>> {
    const size = FileSize.create(input.data.byteLength);
    if (isErr(size)) {
      return err(size.error);
    }
    if (size.value.exceeds(this.limits.maxBytes)) {
      return err(new FileTooLargeError(this.limits.maxBytes));
    }

    const format = ImageFormat.fromMagicBytes(input.data);
    if (format === null) {
      return err(new UnsupportedImageFormatError());
    }

    const metadata = await this.processor.readMetadata(input.data);
    if (isErr(metadata)) {
      return err(metadata.error);
    }
    // Le décodeur doit confirmer ce que disent les magic bytes : sinon, fichier incohérent.
    if (metadata.value.format !== format.name) {
      return err(new CorruptedImageError("contenu incohérent avec le format détecté"));
    }
    const dimensions = ImageDimensions.create(metadata.value.width, metadata.value.height);
    if (isErr(dimensions)) {
      return err(dimensions.error);
    }
    if (dimensions.value.exceeds(this.limits.maxPixelsSide)) {
      return err(new ImageDimensionsTooLargeError(this.limits.maxPixelsSide));
    }

    const image = Image.createOriginal({
      ownerId: input.ownerId,
      storageKey: StorageKey.forOriginal(format),
      format,
      size: size.value,
      dimensions: dimensions.value,
    });

    await this.storage.put(image.storageKey, input.data);
    try {
      await this.images.save(image);
    } catch (error) {
      await this.removeOrphan(image.storageKey);
      throw error;
    }

    return ok({
      id: image.id,
      format: image.format.name,
      sizeBytes: image.size.bytes,
      width: image.dimensions.width,
      height: image.dimensions.height,
      createdAt: image.createdAt,
    });
  }

  /** Nettoyage au mieux : un échec ici ne doit pas masquer l'erreur d'origine. */
  private async removeOrphan(key: StorageKey): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (cleanupError) {
      console.error(`Compensation impossible : fichier orphelin ${key.value}`, cleanupError);
    }
  }
}
