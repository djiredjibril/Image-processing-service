/**
 * Implémentation PostgreSQL (driver `pg`) de `ITransformJobRepository`.
 *
 * Couche : infrastructure (persistance). SQL paramétré uniquement.
 */
import type pg from "pg";
import { TransformJob, type JobStatus } from "../../domain/entities/transform-job.js";
import type { ITransformJobRepository } from "../../domain/repositories/transform-job-repository.js";
import type { RawTransformationInput } from "../../domain/value-objects/transformation-set.js";

interface JobRow {
  readonly id: string;
  readonly owner_id: string;
  readonly source_image_id: string;
  readonly params: RawTransformationInput;
  readonly status: JobStatus;
  readonly result_image_id: string | null;
  readonly error_kind: string | null;
  readonly error_message: string | null;
  readonly attempts: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

const COLUMNS = `id, owner_id, source_image_id, params, status, result_image_id, error_kind, error_message, attempts, created_at, updated_at`;

/** Repository des jobs adossé à PostgreSQL. */
export class PgTransformJobRepository implements ITransformJobRepository {
  constructor(private readonly pool: pg.Pool) {}

  /** Insère le job ; toute erreur (ex. image source inexistante) est relancée. */
  async save(job: TransformJob): Promise<void> {
    const p = job.props;
    await this.pool.query(
      `INSERT INTO transform_jobs (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [p.id, p.ownerId, p.sourceImageId, JSON.stringify(p.transformations), p.status, p.resultImageId, p.errorKind, p.errorMessage, p.attempts, p.createdAt, p.updatedAt],
    );
  }

  /** Met à jour les colonnes qui changent au fil du traitement (jamais le propriétaire ni la source). */
  async update(job: TransformJob): Promise<void> {
    const p = job.props;
    await this.pool.query(
      `UPDATE transform_jobs
       SET status = $2, result_image_id = $3, error_kind = $4, error_message = $5, attempts = $6, updated_at = $7
       WHERE id = $1`,
      [p.id, p.status, p.resultImageId, p.errorKind, p.errorMessage, p.attempts, p.updatedAt],
    );
  }

  /** Renvoie le job ou `null` s'il n'existe pas. */
  async findById(id: string): Promise<TransformJob | null> {
    const result = await this.pool.query<JobRow>(`SELECT ${COLUMNS} FROM transform_jobs WHERE id = $1`, [id]);
    const row = result.rows[0];
    return row === undefined ? null : toJob(row);
  }

  /** Les `limit` jobs les plus récents du propriétaire (index `owner_id, created_at DESC`). */
  async listRecentByOwner(ownerId: string, limit: number): Promise<readonly TransformJob[]> {
    const result = await this.pool.query<JobRow>(
      `SELECT ${COLUMNS} FROM transform_jobs WHERE owner_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
      [ownerId, limit],
    );
    return result.rows.map(toJob);
  }

  /** Supprime le job (sans effet s'il n'existe pas). */
  async delete(id: string): Promise<void> {
    await this.pool.query("DELETE FROM transform_jobs WHERE id = $1", [id]);
  }
}

function toJob(row: JobRow): TransformJob {
  return TransformJob.restore({
    id: row.id,
    ownerId: row.owner_id,
    sourceImageId: row.source_image_id,
    transformations: row.params,
    status: row.status,
    resultImageId: row.result_image_id,
    errorKind: row.error_kind,
    errorMessage: row.error_message,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
