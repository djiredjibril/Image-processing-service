/**
 * Value Object représentant la clé de cache d'une transformation.
 *
 * Couche : domaine.
 */
import { createHash } from "node:crypto";
import type { ImageFormat } from "./image-format.js";
import type { TransformationSet } from "./transformation-set.js";

/**
 * Version du résultat d'un traitement. À INCRÉMENTER dès que le pipeline d'image change de façon visible
 * (nouvel ordre d'opérations, nouvelle taille de police du filigrane…) : toutes les anciennes entrées de
 * cache deviennent alors inutilisables, et on ne ressert jamais un résultat produit par l'ancien code.
 */
export const TRANSFORM_CACHE_VERSION = 1;

/** Éléments qui déterminent entièrement le résultat d'une transformation. */
export interface TransformCacheKeyParams {
  readonly ownerId: string;
  readonly sourceId: string;
  readonly transformations: TransformationSet;
  readonly outputFormat: ImageFormat;
}

/**
 * Empreinte (SHA-256, 64 caractères hexadécimaux) d'une transformation : « cette image source, avec ces
 * paramètres NORMALISÉS, pour cet utilisateur ».
 *
 * Invariants : deux demandes qui produisent forcément le même résultat ont la même clé (valeurs par défaut
 * explicites ou omises, `flip: false` ou absent, rotation -90° ou 270°, ordre des champs du JSON, espaces autour
 * du texte du filigrane) ; deux demandes différentes ont des clés différentes. La clé ne contient pas le contenu
 * du fichier : l'original est immuable, l'identifiant de la source suffit.
 */
export class TransformCacheKey {
  private constructor(public readonly value: string) {}

  /**
   * Calcule la clé d'une transformation.
   *
   * Les paramètres sont placés dans un tableau POSITIONNEL (l'ordre est fixé par construction, donc stable),
   * puis sérialisés en JSON et hachés.
   *
   * @param params - Utilisateur, image source, transformations validées et format de sortie résolu.
   * @returns La clé de cache.
   */
  static create(params: TransformCacheKeyParams): TransformCacheKey {
    const { transformations: t } = params;
    const canonical = [
      TRANSFORM_CACHE_VERSION,
      params.ownerId,
      params.sourceId,
      t.crop === null ? null : [t.crop.x, t.crop.y, t.crop.width, t.crop.height],
      t.rotation === null || t.rotation.isIdentity ? null : ((t.rotation.degrees % 360) + 360) % 360,
      t.flip,
      t.mirror,
      t.resize === null ? null : [t.resize.width, t.resize.height, t.resize.fit],
      t.filter === null ? null : t.filter.name,
      t.watermark === null ? null : [t.watermark.text, t.watermark.position, t.watermark.opacity],
      params.outputFormat.name,
      t.quality === null ? null : t.quality.value,
    ];
    return new TransformCacheKey(createHash("sha256").update(JSON.stringify(canonical)).digest("hex"));
  }
}
