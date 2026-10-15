/**
 * Port `IImageRepository` : persistance des métadonnées d'images.
 *
 * Couche : domaine (port). Implémentations : `PgImageRepository` (prod), fake en mémoire (tests).
 */
import type { Image } from "../entities/image.js";

/**
 * Contrat de persistance des images.
 */
export interface IImageRepository {
  /**
   * Enregistre une image.
   *
   * @param image - Image à persister.
   * @throws En cas de panne d'infrastructure (erreur inattendue, pas une erreur métier).
   */
  save(image: Image): Promise<void>;

  /**
   * Cherche une image par identifiant.
   *
   * @param id - Identifiant de l'image.
   * @returns L'image, ou `null` si elle n'existe pas. Ne lève pas d'erreur pour « introuvable ».
   */
  findById(id: string): Promise<Image | null>;
}
