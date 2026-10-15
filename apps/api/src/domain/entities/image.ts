/**
 * Entité `Image` : une image stockée appartenant à un utilisateur.
 *
 * Couche : domaine.
 */
import { randomUUID } from "node:crypto";
import type { FileSize } from "../value-objects/file-size.js";
import type { ImageDimensions } from "../value-objects/image-dimensions.js";
import type { ImageFormat } from "../value-objects/image-format.js";
import type { StorageKey } from "../value-objects/storage-key.js";

/** Données complètes d'une image (utilisées pour reconstruire depuis la base). */
export interface ImageProps {
  readonly id: string;
  readonly ownerId: string;
  readonly storageKey: StorageKey;
  readonly originalId: string | null;
  readonly format: ImageFormat;
  readonly size: FileSize;
  readonly dimensions: ImageDimensions;
  readonly createdAt: Date;
}

/**
 * Image d'un utilisateur.
 *
 * Invariants : immuable ; l'original ne change jamais (une transformation crée un NOUVEAU
 * fichier dérivé) ; `originalId` vaut `null` pour un original et pointe vers l'original
 * pour un dérivé.
 */
export class Image {
  private constructor(
    public readonly id: string,
    public readonly ownerId: string,
    public readonly storageKey: StorageKey,
    public readonly originalId: string | null,
    public readonly format: ImageFormat,
    public readonly size: FileSize,
    public readonly dimensions: ImageDimensions,
    public readonly createdAt: Date,
  ) {}

  /**
   * Crée une nouvelle image ORIGINALE (identifiant et date générés ici).
   *
   * @param params - Propriétaire, clé de stockage et métadonnées déjà validées.
   * @returns Une nouvelle `Image` dont `originalId` est `null`.
   */
  static createOriginal(params: Pick<ImageProps, "ownerId" | "storageKey" | "format" | "size" | "dimensions">): Image {
    return new Image(
      randomUUID(),
      params.ownerId,
      params.storageKey,
      null,
      params.format,
      params.size,
      params.dimensions,
      new Date(),
    );
  }

  /**
   * Crée une image DÉRIVÉE : le résultat d'une transformation, stocké dans un nouveau fichier.
   *
   * @param params - Propriétaire, clé de stockage, métadonnées, et `originalId` : l'identifiant de l'original
   * d'où elle provient (jamais celui d'un autre dérivé : on remonte toujours à la racine).
   * @returns Une nouvelle `Image` dont `originalId` pointe vers l'original.
   */
  static createDerived(
    params: Pick<ImageProps, "ownerId" | "storageKey" | "format" | "size" | "dimensions"> & { readonly originalId: string },
  ): Image {
    return new Image(
      randomUUID(),
      params.ownerId,
      params.storageKey,
      params.originalId,
      params.format,
      params.size,
      params.dimensions,
      new Date(),
    );
  }

  /**
   * Reconstruit une image existante (ex. lue en base) sans rien générer.
   *
   * @param props - Données déjà validées et persistées.
   * @returns L'`Image` correspondante.
   */
  static restore(props: ImageProps): Image {
    return new Image(
      props.id,
      props.ownerId,
      props.storageKey,
      props.originalId,
      props.format,
      props.size,
      props.dimensions,
      props.createdAt,
    );
  }
}
