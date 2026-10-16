/**
 * Use case `ProcessTransformJob` : exécuter un job de transformation (côté worker).
 *
 * Couche : application. Fait le lien entre la file (qui ne transporte que l'identifiant) et le use case
 * synchrone `TransformImage`, en tenant le statut du job à jour en base.
 */
import { err, isErr, ok, type Result } from "../../domain/shared/result.js";
import { JobNotFoundError } from "../../domain/errors/job-errors.js";
import type { ITransformJobRepository } from "../../domain/repositories/transform-job-repository.js";
import type { TransformImage, TransformImageError } from "./transform-image.js";

/** Issue d'un traitement : le job est terminé en succès, terminé en échec métier, ou l'était déjà. */
export type ProcessJobOutcome = "completed" | "failed" | "already-finished";

/** Type d'erreur enregistré quand toutes les tentatives ont échoué sur une panne d'infrastructure. */
export const PROCESSING_FAILED = "ProcessingFailed";

/**
 * Traite un job de transformation.
 *
 * Deux sortes d'échecs, traitées différemment :
 * - échec MÉTIER (paramètres invalides, image absente ou illisible) : réessayer donnerait le même résultat. Le job
 *   passe `failed` tout de suite, et la file considère le travail comme fait ;
 * - échec TECHNIQUE (base ou stockage en panne) : l'exception remonte au worker, qui laisse la file réessayer
 *   (avec attente croissante). Si toutes les tentatives échouent, `recordFinalFailure` passe le job à `failed`.
 */
export class ProcessTransformJob {
  constructor(
    private readonly jobs: ITransformJobRepository,
    private readonly transformImage: TransformImage,
  ) {}

  /**
   * Exécute le job.
   *
   * Idempotent : un job déjà terminé (livré deux fois par la file) n'est pas retraité.
   * Le propriétaire utilisé est celui enregistré dans le job, jamais une donnée venue de la file.
   *
   * @param jobId - Identifiant du job à traiter.
   * @returns `Ok(outcome)`, ou `Err(JobNotFoundError)` si le job n'existe plus (inutile de réessayer).
   * @throws Si la base ou le stockage tombent en panne (le worker laisse alors la file réessayer).
   */
  async execute(jobId: string): Promise<Result<ProcessJobOutcome, JobNotFoundError>> {
    const job = await this.jobs.findById(jobId);
    if (job === null) {
      return err(new JobNotFoundError());
    }
    const started = job.startProcessing();
    if (isErr(started)) {
      return ok("already-finished");
    }
    await this.jobs.update(started.value);

    const result = await this.transformImage.execute({
      ownerId: job.ownerId,
      imageId: job.props.sourceImageId,
      transformations: job.props.transformations,
    });

    if (isErr(result)) {
      const failed = started.value.fail(result.error.kind, describe(result.error));
      if (isErr(failed)) return ok("already-finished");
      await this.jobs.update(failed.value);
      return ok("failed");
    }
    const completed = started.value.complete(result.value.image.id);
    if (isErr(completed)) return ok("already-finished");
    await this.jobs.update(completed.value);
    return ok("completed");
  }

  /**
   * Marque un job en échec définitif après épuisement des tentatives (panne technique persistante).
   *
   * Sans effet si le job n'existe plus ou est déjà terminé. Le message est générique : aucun détail interne
   * (chemin, requête SQL) n'est exposé au client.
   *
   * @param jobId - Identifiant du job.
   */
  async recordFinalFailure(jobId: string): Promise<void> {
    const job = await this.jobs.findById(jobId);
    if (job === null) return;
    const failed = job.fail(PROCESSING_FAILED, "Le traitement a échoué après plusieurs tentatives");
    if (isErr(failed)) return;
    await this.jobs.update(failed.value);
  }
}

/** Message client d'une erreur métier de transformation. */
function describe(error: TransformImageError): string {
  switch (error.kind) {
    case "ImageNotFound":
      return "Image source introuvable";
    case "InvalidTransformation":
      return `Transformation invalide : ${error.reason}`;
    case "CorruptedImage":
      return `Image illisible : ${error.reason}`;
  }
}
