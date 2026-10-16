/**
 * Port `ITransformJobRepository` : persistance des jobs de transformation.
 *
 * Couche : domaine (port). Implémentations : `PgTransformJobRepository` (prod), fake en mémoire (tests).
 */
import type { TransformJob } from "../entities/transform-job.js";

/**
 * Contrat de persistance des jobs. PostgreSQL est la source de vérité de leur statut.
 */
export interface ITransformJobRepository {
  /**
   * Enregistre un nouveau job.
   *
   * @param job - Job à insérer.
   * @throws En cas de panne d'infrastructure (erreur inattendue, pas une erreur métier).
   */
  save(job: TransformJob): Promise<void>;

  /**
   * Remplace l'état d'un job existant (statut, résultat, erreur, tentatives).
   *
   * @param job - Job dans son nouvel état.
   * @throws En cas de panne d'infrastructure.
   */
  update(job: TransformJob): Promise<void>;

  /**
   * Cherche un job par identifiant.
   *
   * @returns Le job, ou `null` s'il n'existe pas. Ne lève pas d'erreur pour « introuvable ».
   */
  findById(id: string): Promise<TransformJob | null>;

  /**
   * Liste les jobs les plus récents d'un propriétaire.
   *
   * @param ownerId - Propriétaire.
   * @param limit - Nombre maximal de jobs (entier >= 1).
   * @returns Ses jobs, du plus récent au plus ancien (liste vide s'il n'en a pas).
   * @throws En cas de panne d'infrastructure.
   */
  listRecentByOwner(ownerId: string, limit: number): Promise<readonly TransformJob[]>;

  /**
   * Supprime un job (utilisé pour annuler un job qui n'a pas pu être mis en file).
   *
   * @throws En cas de panne d'infrastructure.
   */
  delete(id: string): Promise<void>;
}
