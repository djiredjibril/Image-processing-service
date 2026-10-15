/**
 * Use case `ListImages` : lister les images de l'utilisateur connecté, avec pagination.
 *
 * Couche : application.
 */
import type { InvalidPaginationError } from "../../domain/errors/image-errors.js";
import type { IImageRepository } from "../../domain/repositories/image-repository.js";
import { Pagination } from "../../domain/value-objects/pagination.js";
import { type ImageSummary, toImageSummary } from "../shared/image-summary.js";
import { err, isErr, ok, type Result } from "../shared/result.js";

/** Données d'entrée : le propriétaire et la page demandée. */
export interface ListImagesInput {
  readonly ownerId: string;
  readonly page: number;
  readonly limit: number;
}

/** Une page de résultats avec le total, pour que le client calcule le nombre de pages. */
export interface ListImagesOutput {
  readonly items: readonly ImageSummary[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
}

/**
 * Liste les images du propriétaire, la plus récente d'abord.
 *
 * Isolation : le filtre sur `ownerId` est appliqué par le repository ; les images d'un
 * autre utilisateur n'apparaissent jamais, ni dans `items` ni dans `total`.
 */
export class ListImages {
  constructor(private readonly images: IImageRepository) {}

  /**
   * Exécute la liste.
   *
   * @param input - Propriétaire, page et limite.
   * @returns `Ok({ items, page, limit, total })`, ou `Err(InvalidPaginationError)` si page ou limite sont hors bornes.
   */
  async execute(input: ListImagesInput): Promise<Result<ListImagesOutput, InvalidPaginationError>> {
    const pagination = Pagination.create(input.page, input.limit);
    if (isErr(pagination)) {
      return err(pagination.error);
    }
    const { items, total } = await this.images.listByOwner(input.ownerId, pagination.value);
    return ok({
      items: items.map(toImageSummary),
      page: pagination.value.page,
      limit: pagination.value.limit,
      total,
    });
  }
}
