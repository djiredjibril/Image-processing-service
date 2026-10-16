/**
 * Entité `TransformJob` : une demande de transformation traitée en arrière-plan.
 *
 * Couche : domaine.
 */
import { randomUUID } from "node:crypto";
import { InvalidJobTransitionError } from "../errors/job-errors.js";
import { err, ok, type Result } from "../shared/result.js";
import type { RawTransformationInput } from "../value-objects/transformation-set.js";

/** États d'un job : `queued` → `processing` → `completed` | `failed` (les deux derniers sont terminaux). */
export type JobStatus = "queued" | "processing" | "completed" | "failed";

/** Données complètes d'un job (utilisées pour reconstruire depuis la base). */
export interface TransformJobProps {
  readonly id: string;
  readonly ownerId: string;
  readonly sourceImageId: string;
  readonly transformations: RawTransformationInput;
  readonly status: JobStatus;
  readonly resultImageId: string | null;
  readonly errorKind: string | null;
  readonly errorMessage: string | null;
  readonly attempts: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Job de transformation.
 *
 * Invariants : immuable (chaque transition renvoie un NOUVEAU job) ; `queued` → `processing` → `completed` | `failed` ;
 * `completed` et `failed` sont terminaux (un job terminé ne repart jamais) ; `processing` peut se répéter (nouvelle
 * tentative après une panne) ; `resultImageId` n'existe que pour `completed` et `errorKind` que pour `failed`.
 */
export class TransformJob {
  private constructor(public readonly props: TransformJobProps) {}

  /** Identifiant du job (aussi l'identifiant du job BullMQ). */
  get id(): string {
    return this.props.id;
  }

  /** Propriétaire du job. */
  get ownerId(): string {
    return this.props.ownerId;
  }

  /** État courant. */
  get status(): JobStatus {
    return this.props.status;
  }

  /**
   * Crée un nouveau job en attente (identifiant et dates générés ici).
   *
   * @param params - Propriétaire, image source et transformations demandées (non encore appliquées).
   * @returns Un job `queued`, 0 tentative.
   */
  static create(params: Pick<TransformJobProps, "ownerId" | "sourceImageId" | "transformations">): TransformJob {
    const now = new Date();
    return new TransformJob({
      id: randomUUID(),
      ownerId: params.ownerId,
      sourceImageId: params.sourceImageId,
      transformations: params.transformations,
      status: "queued",
      resultImageId: null,
      errorKind: null,
      errorMessage: null,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Reconstruit un job depuis ses données persistées (sans règle : la base est supposée cohérente).
   *
   * @param props - Données complètes.
   * @returns Le job.
   */
  static restore(props: TransformJobProps): TransformJob {
    return new TransformJob(props);
  }

  /**
   * Démarre (ou redémarre, après une panne) le traitement : compte une tentative de plus.
   *
   * @returns Le job `processing`, ou `Err(InvalidJobTransitionError)` s'il est déjà terminé.
   */
  startProcessing(): Result<TransformJob, InvalidJobTransitionError> {
    if (this.status === "completed" || this.status === "failed") {
      return err(new InvalidJobTransitionError(this.status, "processing"));
    }
    return ok(this.with({ status: "processing", attempts: this.props.attempts + 1 }));
  }

  /**
   * Termine le job avec succès.
   *
   * @param resultImageId - Identifiant de l'image dérivée produite.
   * @returns Le job `completed`, ou `Err(InvalidJobTransitionError)` s'il n'était pas en cours de traitement.
   */
  complete(resultImageId: string): Result<TransformJob, InvalidJobTransitionError> {
    if (this.status !== "processing") {
      return err(new InvalidJobTransitionError(this.status, "completed"));
    }
    return ok(this.with({ status: "completed", resultImageId }));
  }

  /**
   * Termine le job en échec définitif.
   *
   * @param errorKind - Type de l'erreur (ex. `InvalidTransformation`), destiné au client.
   * @param errorMessage - Message lisible (jamais de détail interne sensible).
   * @returns Le job `failed`, ou `Err(InvalidJobTransitionError)` s'il est déjà terminé.
   */
  fail(errorKind: string, errorMessage: string): Result<TransformJob, InvalidJobTransitionError> {
    if (this.status === "completed" || this.status === "failed") {
      return err(new InvalidJobTransitionError(this.status, "failed"));
    }
    return ok(this.with({ status: "failed", errorKind, errorMessage }));
  }

  private with(changes: Partial<TransformJobProps>): TransformJob {
    return new TransformJob({ ...this.props, ...changes, updatedAt: new Date() });
  }
}
