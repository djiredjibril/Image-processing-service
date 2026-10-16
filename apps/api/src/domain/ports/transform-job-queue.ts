/**
 * Port `ITransformJobQueue` : file d'attente des jobs de transformation.
 *
 * Couche : domaine (port). Implémentation : `BullMqTransformJobQueue` ; fake en mémoire pour les tests.
 */
import type { QueueUnavailableError } from "../errors/job-errors.js";
import type { Result } from "../shared/result.js";

/**
 * Contrat de la file. Seul l'IDENTIFIANT du job circule dans la file : les paramètres et le statut vivent en base.
 *
 * Contrairement au cache et au rate limiting, la file n'est PAS « fail-open » : sans elle, le travail ne serait
 * jamais fait. Si elle est injoignable, `enqueue` le dit par une erreur typée et l'appelant répond 503.
 */
export interface ITransformJobQueue {
  /**
   * Met un job en file pour qu'un worker le traite.
   *
   * @param jobId - Identifiant du job déjà enregistré en base.
   * @returns `Ok` une fois le job accepté par la file, ou `Err(QueueUnavailableError)` si elle est injoignable.
   * Ne lève jamais d'erreur.
   */
  enqueue(jobId: string): Promise<Result<void, QueueUnavailableError>>;
}
