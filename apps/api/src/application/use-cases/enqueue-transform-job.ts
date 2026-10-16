/**
 * Use case `EnqueueTransformJob` : demander une transformation traitée en arrière-plan.
 *
 * Couche : application.
 */
import { TransformJob } from "../../domain/entities/transform-job.js";
import { ImageNotFoundError, InvalidTransformationError } from "../../domain/errors/image-errors.js";
import type { QueueUnavailableError } from "../../domain/errors/job-errors.js";
import type { ITransformJobQueue } from "../../domain/ports/transform-job-queue.js";
import type { IImageRepository } from "../../domain/repositories/image-repository.js";
import type { ITransformJobRepository } from "../../domain/repositories/transform-job-repository.js";
import { type RawTransformationInput, TransformationSet } from "../../domain/value-objects/transformation-set.js";
import { type JobSummary, toJobSummary } from "../shared/job-summary.js";
import { err, isErr, ok, type Result } from "../shared/result.js";
import type { TransformLimits } from "./transform-image.js";

/** Données d'entrée : l'appelant, l'image source et les transformations brutes. */
export interface EnqueueTransformJobInput {
  readonly ownerId: string;
  readonly imageId: string;
  readonly transformations: RawTransformationInput;
}

/** Erreurs métier possibles de `EnqueueTransformJob`. */
export type EnqueueTransformJobError = ImageNotFoundError | InvalidTransformationError | QueueUnavailableError;

/**
 * Enregistre un job puis le met en file ; le traitement lui-même est fait plus tard par un worker.
 *
 * Validation « fail fast » : l'autorisation, les paramètres et leur cohérence avec la source sont vérifiés AVANT de
 * créer le job, pour qu'une demande manifestement invalide reçoive un 400 immédiat plutôt qu'un job qui échouera plus
 * tard. Le worker revalide tout (l'état peut changer entre la demande et le traitement).
 *
 * Ordre : (1) écrire le job en base, (2) le mettre en file. Dans cet ordre, un worker ne peut jamais recevoir un
 * identifiant que la base ne connaît pas. Si la mise en file échoue, le job est supprimé : on ne laisse pas en base un
 * job `queued` que rien ne traitera jamais.
 */
export class EnqueueTransformJob {
  constructor(
    private readonly images: IImageRepository,
    private readonly jobs: ITransformJobRepository,
    private readonly queue: ITransformJobQueue,
    private readonly limits: TransformLimits,
  ) {}

  /**
   * Crée et met en file le job.
   *
   * @param input - Appelant, image source et transformations demandées.
   * @returns `Ok(job)` au statut `queued`, ou `Err` parmi : `ImageNotFoundError` (inconnue ou d'un autre utilisateur),
   * `InvalidTransformationError` (paramètres invalides ou incohérents avec la source), `QueueUnavailableError` (file
   * injoignable : rien n'est conservé).
   * @throws Si la base tombe en panne (erreur inattendue).
   */
  async execute(input: EnqueueTransformJobInput): Promise<Result<JobSummary, EnqueueTransformJobError>> {
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

    const job = TransformJob.create({ ownerId: input.ownerId, sourceImageId: source.id, transformations: input.transformations });
    await this.jobs.save(job);
    const queued = await this.queue.enqueue(job.id);
    if (isErr(queued)) {
      await this.jobs.delete(job.id);
      return err(queued.error);
    }
    return ok(toJobSummary(job, null));
  }
}
