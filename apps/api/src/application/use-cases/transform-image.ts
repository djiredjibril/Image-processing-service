/**
 * Use case `TransformImage` : créer une image dérivée à partir d'une image existante.
 *
 * Couche : application.
 */
import { Image } from "../../domain/entities/image.js";
import {
  type CorruptedImageError,
  ImageNotFoundError,
  InvalidTransformationError,
} from "../../domain/errors/image-errors.js";
import type { IFileStorage } from "../../domain/ports/file-storage.js";
import type { IImageProcessor } from "../../domain/ports/image-processor.js";
import type { IImageRepository } from "../../domain/repositories/image-repository.js";
import { FileSize } from "../../domain/value-objects/file-size.js";
import { ImageDimensions } from "../../domain/value-objects/image-dimensions.js";
import { StorageKey } from "../../domain/value-objects/storage-key.js";
import { type RawTransformationInput, TransformationSet } from "../../domain/value-objects/transformation-set.js";
import { type ImageSummary, toImageSummary } from "../shared/image-summary.js";
import { readAll } from "../shared/read-stream.js";
import { err, isErr, ok, type Result } from "../shared/result.js";
import { storeImage } from "../shared/store-image.js";

/** Limites de validation, issues de la configuration. */
export interface TransformLimits {
  /** Taille maximale d'un côté en pixels (`MAX_IMAGE_PIXELS_SIDE`), en entrée comme en sortie. */
  readonly maxPixelsSide: number;
}

/** Données d'entrée : l'appelant, l'image source et les transformations brutes. */
export interface TransformImageInput {
  readonly ownerId: string;
  readonly imageId: string;
  readonly transformations: RawTransformationInput;
}

/** Métadonnées publiques de l'image dérivée créée. */
export type TransformImageOutput = ImageSummary;

/** Erreurs métier possibles de `TransformImage`. */
export type TransformImageError = ImageNotFoundError | InvalidTransformationError | CorruptedImageError;

/**
 * Transforme une image et enregistre le résultat comme NOUVELLE image.
 *
 * L'original est immuable : la source n'est jamais modifiée. La source peut être elle-même un
 * dérivé ; le nouveau dérivé pointe alors vers l'ORIGINAL racine (`originalId`), pas vers elle.
 */
export class TransformImage {
  constructor(
    private readonly images: IImageRepository,
    private readonly storage: IFileStorage,
    private readonly processor: IImageProcessor,
    private readonly limits: TransformLimits,
  ) {}

  /**
   * Exécute la transformation.
   *
   * Ordre : autorisation (source du propriétaire ?), validation des paramètres, cohérence avec
   * la source, lecture, transformation, contrôle de la taille du résultat, écriture avec compensation.
   *
   * @param input - Appelant, image source et transformations demandées.
   * @returns `Ok(métadonnées du dérivé)`, ou `Err` parmi : `ImageNotFoundError` (inconnue, d'un autre
   * utilisateur, ou fichier absent), `InvalidTransformationError` (paramètres invalides, crop hors image,
   * résultat trop grand), `CorruptedImageError` (source illisible).
   * @throws Si le stockage ou la base tombent en panne (erreur inattendue).
   */
  async execute(input: TransformImageInput): Promise<Result<TransformImageOutput, TransformImageError>> {
    const source = await this.images.findById(input.imageId);
    if (source?.ownerId !== input.ownerId) {
      return err(new ImageNotFoundError());
    }

    const set = TransformationSet.create(input.transformations, { maxSide: this.limits.maxPixelsSide });
    if (isErr(set)) {
      return err(set.error);
    }
    const incompatible = set.value.checkAgainst(source);
    if (incompatible !== null) {
      return err(incompatible);
    }

    const stream = await this.storage.get(source.storageKey);
    if (stream === null) {
      console.error(`Incohérence : la ligne ${source.id} existe mais son fichier est absent du stockage`);
      return err(new ImageNotFoundError());
    }

    const outputFormat = set.value.outputFormat(source.format);
    const transformed = await this.processor.transform(await readAll(stream), set.value, outputFormat);
    if (isErr(transformed)) {
      return err(transformed.error);
    }

    const dimensions = ImageDimensions.create(transformed.value.width, transformed.value.height);
    const size = FileSize.create(transformed.value.data.byteLength);
    if (isErr(dimensions) || isErr(size)) {
      return err(new InvalidTransformationError("le résultat de la transformation est vide ou invalide"));
    }
    if (dimensions.value.exceeds(this.limits.maxPixelsSide)) {
      return err(
        new InvalidTransformationError(`le résultat dépasse ${String(this.limits.maxPixelsSide)} px par côté (ajoutez un resize)`),
      );
    }

    const derived = Image.createDerived({
      ownerId: input.ownerId,
      storageKey: StorageKey.forDerived(transformed.value.format),
      originalId: source.originalId ?? source.id,
      format: transformed.value.format,
      size: size.value,
      dimensions: dimensions.value,
    });
    await storeImage(this.storage, this.images, derived, transformed.value.data);
    return ok(toImageSummary(derived));
  }
}
