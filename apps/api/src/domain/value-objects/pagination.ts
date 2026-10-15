/**
 * Value Object représentant une demande de pagination.
 *
 * Couche : domaine.
 */
import { InvalidPaginationError } from "../errors/image-errors.js";
import { err, ok, type Result } from "../shared/result.js";

/**
 * Page et taille de page demandées.
 *
 * Invariants : `page` est un entier >= 1 ; `limit` est un entier compris entre 1 et
 * `MAX_LIMIT`. Le plafond évite qu'un client demande toute la table d'un coup.
 */
export class Pagination {
  static readonly DEFAULT_PAGE = 1;
  static readonly DEFAULT_LIMIT = 10;
  static readonly MAX_LIMIT = 50;

  private constructor(
    public readonly page: number,
    public readonly limit: number,
  ) {}

  /**
   * Construit une pagination valide.
   *
   * @param page - Numéro de page, à partir de 1.
   * @param limit - Nombre d'éléments par page, entre 1 et 50.
   * @returns `Ok(Pagination)`, ou `Err(InvalidPaginationError)` si une valeur est hors bornes ou non entière.
   */
  static create(page: number, limit: number): Result<Pagination, InvalidPaginationError> {
    if (!Number.isInteger(page) || page < 1) {
      return err(new InvalidPaginationError("page doit être un entier >= 1"));
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > Pagination.MAX_LIMIT) {
      return err(new InvalidPaginationError(`limit doit être un entier entre 1 et ${String(Pagination.MAX_LIMIT)}`));
    }
    return ok(new Pagination(page, limit));
  }

  /** Nombre d'éléments à sauter pour atteindre la page demandée (clause SQL `OFFSET`). */
  get offset(): number {
    return (this.page - 1) * this.limit;
  }
}
