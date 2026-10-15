/**
 * Implémentation PostgreSQL (driver `pg`) de `IImageRepository`.
 *
 * Couche : infrastructure (persistance). SQL paramétré uniquement.
 */
import type pg from "pg";
import { Image } from "../../domain/entities/image.js";
import type { IImageRepository } from "../../domain/repositories/image-repository.js";
import { isErr } from "../../domain/shared/result.js";
import { FileSize } from "../../domain/value-objects/file-size.js";
import { ImageDimensions } from "../../domain/value-objects/image-dimensions.js";
import { ImageFormat } from "../../domain/value-objects/image-format.js";
import { StorageKey } from "../../domain/value-objects/storage-key.js";

interface ImageRow {
  readonly id: string;
  readonly owner_id: string;
  readonly storage_key: string;
  readonly original_id: string | null;
  readonly format: string;
  readonly size_bytes: number;
  readonly width: number;
  readonly height: number;
  readonly created_at: Date;
}

/** Repository des images adossé à PostgreSQL. */
export class PgImageRepository implements IImageRepository {
  constructor(private readonly pool: pg.Pool) {}

  /** Insère l'image ; toute erreur (ex. propriétaire inexistant) est relancée. */
  async save(image: Image): Promise<void> {
    await this.pool.query(
      `INSERT INTO images (id, owner_id, storage_key, original_id, format, size_bytes, width, height, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        image.id,
        image.ownerId,
        image.storageKey.value,
        image.originalId,
        image.format.name,
        image.size.bytes,
        image.dimensions.width,
        image.dimensions.height,
        image.createdAt,
      ],
    );
  }

  /** Renvoie l'image ou `null` si elle n'existe pas. */
  async findById(id: string): Promise<Image | null> {
    const result = await this.pool.query<ImageRow>(
      `SELECT id, owner_id, storage_key, original_id, format, size_bytes, width, height, created_at
       FROM images WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? null : toImage(row);
  }
}

/** Reconstruit l'entité ; une valeur invalide en base signalerait des données corrompues (bug). */
function toImage(row: ImageRow): Image {
  const format = ImageFormat.fromName(row.format);
  const size = FileSize.create(row.size_bytes);
  const dimensions = ImageDimensions.create(row.width, row.height);
  if (format === null || isErr(size) || isErr(dimensions)) {
    throw new Error(`Image corrompue en base : ${row.id}`);
  }
  return Image.restore({
    id: row.id,
    ownerId: row.owner_id,
    storageKey: StorageKey.restore(row.storage_key),
    originalId: row.original_id,
    format,
    size: size.value,
    dimensions: dimensions.value,
    createdAt: row.created_at,
  });
}
