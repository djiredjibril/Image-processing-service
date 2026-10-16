/**
 * Use case `GetJob` : consulter le statut d'un job de transformation (le « polling » du client).
 *
 * Couche : application.
 */
import { JobNotFoundError } from "../../domain/errors/job-errors.js";
import type { IImageRepository } from "../../domain/repositories/image-repository.js";
import type { ITransformJobRepository } from "../../domain/repositories/transform-job-repository.js";
import { type JobSummary, toJobSummary } from "../shared/job-summary.js";
import { toImageSummary } from "../shared/image-summary.js";
import { err, ok, type Result } from "../shared/result.js";

/** Données d'entrée. */
export interface GetJobInput {
  readonly ownerId: string;
  readonly jobId: string;
}

/**
 * Renvoie le statut d'un job de l'appelant.
 *
 * Autorisation par propriétaire : un job inconnu, ou appartenant à un autre utilisateur, donne la MÊME erreur
 * (404, jamais 403), comme pour les images. Quand le job est `completed`, la réponse inclut l'image dérivée.
 */
export class GetJob {
  constructor(
    private readonly jobs: ITransformJobRepository,
    private readonly images: IImageRepository,
  ) {}

  /**
   * Lit le job.
   *
   * @param input - Identifiants du job et de l'appelant.
   * @returns `Ok(résumé)`, ou `Err(JobNotFoundError)` si le job n'existe pas ou n'appartient pas à l'appelant.
   * @throws Si la base tombe en panne.
   */
  async execute(input: GetJobInput): Promise<Result<JobSummary, JobNotFoundError>> {
    const job = await this.jobs.findById(input.jobId);
    if (job?.ownerId !== input.ownerId) {
      return err(new JobNotFoundError());
    }
    const resultId = job.props.resultImageId;
    const image = job.status === "completed" && resultId !== null ? await this.images.findById(resultId) : null;
    return ok(toJobSummary(job, image === null ? null : toImageSummary(image)));
  }
}
