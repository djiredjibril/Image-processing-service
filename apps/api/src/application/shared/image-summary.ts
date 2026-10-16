/**
 * Représentation publique d'une image, partagée par les use cases.
 *
 * Couche : application (partagé). Ne contient jamais la clé de stockage interne ni l'identité du propriétaire.
 */
import type { Image } from "../../domain/entities/image.js";

/** Métadonnées publiques d'une image. */
export interface ImageSummary {
  readonly id: string;
  /** `null` pour un original ; identifiant de l'original pour une image dérivée. */
  readonly originalId: string | null;
  readonly format: string;
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
  readonly createdAt: Date;
}

/**
 * Convertit une entité en résumé public.
 *
 * @param image - Image du domaine.
 * @returns Ses métadonnées publiques.
 */
export function toImageSummary(image: Image): ImageSummary {
  return {
    id: image.id,
    originalId: image.originalId,
    format: image.format.name,
    sizeBytes: image.size.bytes,
    width: image.dimensions.width,
    height: image.dimensions.height,
    createdAt: image.createdAt,
  };
}
