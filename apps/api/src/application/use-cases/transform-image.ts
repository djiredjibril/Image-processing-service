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
  ServerBusyError,
} from "../../domain/errors/image-errors.js";
import type { IFileStorage } from "../../domain/ports/file-storage.js";
import type { IImageProcessor } from "../../domain/ports/image-processor.js";
import { type IStatsCounters, NO_STATS } from "../../domain/ports/monitoring.js";
import { type IWorkSlots, UNLIMITED_WORK_SLOTS } from "../../domain/ports/work-slots.js";
import type { ITransformCache } from "../../domain/ports/transform-cache.js";
import type { IImageRepository } from "../../domain/repositories/image-repository.js";
import { FileSize } from "../../domain/value-objects/file-size.js";
import { ImageDimensions } from "../../domain/value-objects/image-dimensions.js";
import type { ImageFormat } from "../../domain/value-objects/image-format.js";
import { StorageKey } from "../../domain/value-objects/storage-key.js";
import { TransformCacheKey } from "../../domain/value-objects/transform-cache-key.js";
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

/** Durée maximale d'attente d'une requête identique déjà en cours de traitement. */
export const CACHE_WAIT_MS = 5000;

/** Résultat d'une transformation : le dérivé, et s'il vient du cache (aucun traitement ni création). */
export interface TransformImageOutput {
  /** Métadonnées publiques de l'image dérivée (jamais la clé de stockage interne). */
  readonly image: ImageSummary;
  /** `true` si ce dérivé existait déjà : rien n'a été recalculé ni créé. */
  readonly cached: boolean;
}

/** Erreurs métier possibles de `TransformImage`. */
export type TransformImageError = ImageNotFoundError | InvalidTransformationError | CorruptedImageError | ServerBusyError;

/**
 * Transforme une image et enregistre le résultat comme NOUVELLE image.
 *
 * L'original est immuable : la source n'est jamais modifiée. La source peut être elle-même un
 * dérivé ; le nouveau dérivé pointe alors vers l'ORIGINAL racine (`originalId`), pas vers elle.
 *
 * Cache : une demande identique (même utilisateur, même source, mêmes paramètres une fois normalisés) renvoie
 * le dérivé déjà produit, sans retraiter l'image ni créer de doublon. Deux demandes identiques SIMULTANÉES sont
 * sérialisées par un verrou : une seule calcule, l'autre attend son résultat.
 */
export class TransformImage {
  constructor(
    private readonly images: IImageRepository,
    private readonly storage: IFileStorage,
    private readonly processor: IImageProcessor,
    private readonly cache: ITransformCache,
    private readonly limits: TransformLimits,
    private readonly slots: IWorkSlots = UNLIMITED_WORK_SLOTS,
    private readonly stats: IStatsCounters = NO_STATS,
  ) {}

  /**
   * Exécute la transformation.
   *
   * Ordre : autorisation (source du propriétaire ?), validation des paramètres, cohérence avec la source,
   * recherche dans le cache, verrou, puis (sinon) lecture, transformation, contrôle de la taille du résultat
   * et écriture avec compensation. Un résultat n'est mis en cache qu'une fois le dérivé enregistré en base.
   *
   * @param input - Appelant, image source et transformations demandées.
   * @returns `Ok({ image, cached })`, ou `Err` parmi : `ImageNotFoundError` (inconnue, d'un autre
   * utilisateur, ou fichier absent), `InvalidTransformationError` (paramètres invalides, crop hors image,
   * résultat trop grand), `CorruptedImageError` (source illisible), `ServerBusyError` (plafond de traitements simultanés atteint,
   * et la réponse n'était pas dans le cache).
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

    const outputFormat = set.value.outputFormat(source.format);
    const key = TransformCacheKey.create({ ownerId: input.ownerId, sourceId: source.id, transformations: set.value, outputFormat });
    const rootId = source.originalId ?? source.id;

    const cached = await this.findCached(await this.cache.get(key), input.ownerId, rootId);
    if (cached !== null) {
      void this.stats.increment("cache_hit");
      return ok({ image: cached, cached: true });
    }

    const lock = await this.cache.acquireLock(key);
    try {
      // Verrou refusé : une requête identique est en cours, on attend son résultat (au plus CACHE_WAIT_MS).
      // Verrou obtenu : on revérifie le cache, car une requête a pu se terminer entre notre lecture et le verrou.
      const awaited = lock === null ? await this.cache.waitFor(key, CACHE_WAIT_MS) : await this.cache.get(key);
      const afterWait = await this.findCached(awaited, input.ownerId, rootId);
      if (afterWait !== null) {
        void this.stats.increment("cache_hit");
        return ok({ image: afterWait, cached: true });
      }

      // Le plafond ne s'applique qu'ici, au travail COÛTEUX : une réponse servie par le cache ne le consomme jamais.
      const slot = this.slots.tryAcquire();
      if (slot === null) {
        return err(new ServerBusyError());
      }
      let created: Result<ImageSummary, TransformImageError>;
      try {
        created = await this.createDerived(input, source, set.value, outputFormat, rootId);
      } finally {
        slot.release();
      }
      if (isErr(created)) {
        return err(created.error);
      }
      await this.cache.set(key, created.value.id);
      void this.stats.increment("cache_miss");
      return ok({ image: created.value, cached: false });
    } finally {
      await lock?.release();
    }
  }

  /**
   * Vérifie qu'une entrée de cache est toujours valable avant de la servir.
   *
   * Le cache n'est qu'un index : on contrôle en base que le dérivé existe encore, appartient bien à l'appelant et
   * descend de la même racine. Une entrée périmée (dérivé supprimé) ou incohérente (cache empoisonné) est ignorée,
   * et la transformation est refaite.
   */
  private async findCached(derivedId: string | null, ownerId: string, rootId: string): Promise<ImageSummary | null> {
    if (derivedId === null) {
      return null;
    }
    const image = await this.images.findById(derivedId);
    if (image?.ownerId !== ownerId || image.originalId !== rootId) {
      return null;
    }
    return toImageSummary(image);
  }

  /** Lit la source, la transforme, contrôle le résultat, puis l'enregistre comme nouvelle image dérivée. */
  private async createDerived(
    input: TransformImageInput,
    source: Image,
    set: TransformationSet,
    outputFormat: ImageFormat,
    rootId: string,
  ): Promise<Result<ImageSummary, TransformImageError>> {
    const stream = await this.storage.get(source.storageKey);
    if (stream === null) {
      console.error(`Incohérence : la ligne ${source.id} existe mais son fichier est absent du stockage`);
      return err(new ImageNotFoundError());
    }

    const transformed = await this.processor.transform(await readAll(stream), set, outputFormat);
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
      originalId: rootId,
      format: transformed.value.format,
      size: size.value,
      dimensions: dimensions.value,
    });
    await storeImage(this.storage, this.images, derived, transformed.value.data);
    return ok(toImageSummary(derived));
  }
}
