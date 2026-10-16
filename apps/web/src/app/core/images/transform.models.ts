/**
 * Modèles des transformations d'images et des jobs asynchrones échangés avec l'API.
 *
 * Rôle : décrire le contrat JSON de `POST /images/:id/transform`, `POST /images/:id/jobs`, `GET /jobs/:id` et `GET /images/:id/url`.
 */
import { ImageSummary } from './image.models';

/** Modes d'ajustement d'un redimensionnement (`fit` de l'API ; « inside » par défaut côté serveur). */
export const RESIZE_FITS = ['inside', 'cover', 'contain', 'fill', 'outside'] as const;
/** Mode d'ajustement. */
export type ResizeFit = (typeof RESIZE_FITS)[number];

/** Filtres de couleur disponibles. */
export const FILTERS = ['grayscale', 'sepia'] as const;
/** Filtre de couleur. */
export type Filter = (typeof FILTERS)[number];

/** Emplacements possibles du filigrane. */
export const WATERMARK_POSITIONS = ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center'] as const;
/** Emplacement du filigrane. */
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

/** Formats de sortie. */
export const OUTPUT_FORMATS = ['jpeg', 'png', 'webp'] as const;
/** Format de sortie. */
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** Corps de `POST /images/:id/transform` et de `POST /images/:id/jobs` : toutes les clés sont optionnelles, une au moins est requise. */
export interface TransformBody {
  readonly crop?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly rotate?: number;
  readonly flip?: boolean;
  readonly mirror?: boolean;
  readonly resize?: { readonly width?: number; readonly height?: number; readonly fit?: ResizeFit };
  readonly filter?: Filter;
  readonly watermark?: { readonly text: string; readonly position?: WatermarkPosition; readonly opacity?: number };
  readonly format?: OutputFormat;
  readonly quality?: number;
}

/** Résultat d'une transformation synchrone. */
export interface TransformResult {
  /** L'image dérivée (nouvelle ou déjà produite). */
  readonly image: ImageSummary;
  /** `true` si la même transformation avait déjà été faite (réponse 200, `X-Cache: HIT`) : rien n'a été recalculé. */
  readonly cached: boolean;
}

/** États d'un job : `queued` → `processing` → `completed` | `failed`. */
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

/** Statut public d'un job de transformation asynchrone. */
export interface JobSummary {
  readonly id: string;
  readonly status: JobStatus;
  readonly sourceImageId: string;
  readonly attempts: number;
  /** L'image dérivée produite, présente seulement quand le job est terminé avec succès. */
  readonly image: ImageSummary | null;
  /** La raison de l'échec, présente seulement quand le job a échoué. */
  readonly error: { readonly kind: string; readonly message: string } | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Un job est terminé (plus rien ne changera) quand il a réussi ou échoué. */
export function isFinalStatus(status: JobStatus): boolean {
  return status === 'completed' || status === 'failed';
}

/** Réponse de `GET /images/:id/url` : une URL signée et temporaire vers le stockage (stockage S3 uniquement). */
export interface PresignedUrl {
  readonly url: string;
  readonly expiresInSeconds: number;
  /** Date ISO 8601 d'expiration. */
  readonly expiresAt: string;
}
