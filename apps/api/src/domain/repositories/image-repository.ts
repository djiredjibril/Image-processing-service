/**
 * Port `IImageRepository` : persistance des métadonnées d'images.
 *
 * Couche : domaine (port). Implémentations : `PgImageRepository` (prod), fake en mémoire (tests).
 */
import type { Image } from "../entities/image.js";
import type { Pagination } from "../value-objects/pagination.js";

/** Une page d'images et le nombre total d'images du propriétaire. */
export interface ImagePage {
  readonly items: readonly Image[];
  readonly total: number;
}

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

  /**
   * Liste les images d'un propriétaire, la plus récente d'abord.
   *
   * @param ownerId - Propriétaire : seules SES images sont renvoyées.
   * @param pagination - Page et taille demandées.
   * @returns La page demandée (vide si on dépasse la dernière page) et le total de ses images.
   * Ordre stable : `created_at` décroissant, puis identifiant pour départager les égalités.
   */
  listByOwner(ownerId: string, pagination: Pagination): Promise<ImagePage>;
}
