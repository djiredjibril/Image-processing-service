/**
 * Représentation publique d'un job, partagée par les use cases.
 *
 * Couche : application (partagé). Ne contient jamais l'identité du propriétaire ni de détail interne.
 */
import type { JobStatus, TransformJob } from "../../domain/entities/transform-job.js";
import type { ImageSummary } from "./image-summary.js";

/** Erreur d'un job échoué, telle que présentée au client. */
export interface JobErrorSummary {
  readonly kind: string;
  readonly message: string;
}

/** Statut public d'un job de transformation. */
export interface JobSummary {
  readonly id: string;
  readonly status: JobStatus;
  /** Image sur laquelle porte la transformation. */
  readonly sourceImageId: string;
  /** Nombre de tentatives de traitement déjà démarrées. */
  readonly attempts: number;
  /** L'image dérivée produite : présente seulement quand le job est `completed`. */
  readonly image: ImageSummary | null;
  /** Raison de l'échec : présente seulement quand le job est `failed`. */
  readonly error: JobErrorSummary | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Convertit un job en résumé public.
 *
 * @param job - Job du domaine.
 * @param image - Image dérivée produite (à fournir quand le job est `completed`).
 * @returns Le résumé public.
 */
export function toJobSummary(job: TransformJob, image: ImageSummary | null): JobSummary {
  const { props } = job;
  return {
    id: props.id,
    status: props.status,
    sourceImageId: props.sourceImageId,
    attempts: props.attempts,
    image,
    error: props.errorKind === null ? null : { kind: props.errorKind, message: props.errorMessage ?? "" },
    createdAt: props.createdAt,
    updatedAt: props.updatedAt,
  };
}
