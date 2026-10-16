/** Tests d'intégration de PgTransformJobRepository contre `imageservice_test`. */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Image } from "../../src/domain/entities/image.js";
import { TransformJob } from "../../src/domain/entities/transform-job.js";
import { User } from "../../src/domain/entities/user.js";
import { isOk } from "../../src/domain/shared/result.js";
import { Email } from "../../src/domain/value-objects/email.js";
import { FileSize } from "../../src/domain/value-objects/file-size.js";
import { ImageDimensions } from "../../src/domain/value-objects/image-dimensions.js";
import { ImageFormat } from "../../src/domain/value-objects/image-format.js";
import { PasswordHash } from "../../src/domain/value-objects/password-hash.js";
import { StorageKey } from "../../src/domain/value-objects/storage-key.js";
import { PgImageRepository } from "../../src/infrastructure/persistence/pg-image-repository.js";
import { PgTransformJobRepository } from "../../src/infrastructure/persistence/pg-transform-job-repository.js";
import { PgUserRepository } from "../../src/infrastructure/persistence/pg-user-repository.js";
import { createMigratedTestPool, resetTables } from "../helpers/test-db.js";

let pool: pg.Pool;
let repository: PgTransformJobRepository;
let ownerId: string;
let imageId: string;

function newImage(owner: string): Image {
  const size = FileSize.create(10);
  const dimensions = ImageDimensions.create(4, 4);
  if (!isOk(size) || !isOk(dimensions)) throw new Error("valeurs de test invalides");
  return Image.createOriginal({ ownerId: owner, storageKey: StorageKey.forOriginal(ImageFormat.PNG), format: ImageFormat.PNG, size: size.value, dimensions: dimensions.value });
}

beforeAll(async () => {
  pool = await createMigratedTestPool();
  repository = new PgTransformJobRepository(pool);
});
beforeEach(async () => {
  await resetTables(pool);
  const email = Email.create("owner@example.com");
  if (!isOk(email)) throw new Error("email de test invalide");
  const user = User.create({ email: email.value, passwordHash: PasswordHash.fromHash("h") });
  await new PgUserRepository(pool).save(user);
  ownerId = user.id;
  const image = newImage(ownerId);
  await new PgImageRepository(pool).save(image);
  imageId = image.id;
});
afterAll(async () => {
  await pool.end();
});

const newJob = (): TransformJob =>
  TransformJob.create({ ownerId, sourceImageId: imageId, transformations: { rotate: 90, resize: { width: 10 }, watermark: { text: "© é" } } });

describe("PgTransformJobRepository", () => {
  it("save puis findById restitue le job, paramètres JSON compris", async () => {
    const job = newJob();
    await repository.save(job);
    const found = await repository.findById(job.id);
    expect(found?.props).toMatchObject({
      id: job.id,
      ownerId,
      sourceImageId: imageId,
      status: "queued",
      attempts: 0,
      resultImageId: null,
      transformations: { rotate: 90, resize: { width: 10 }, watermark: { text: "© é" } },
    });
    expect(found?.props.createdAt.getTime()).toBe(job.props.createdAt.getTime());
  });

  it("findById renvoie null pour un job inconnu", async () => {
    expect(await repository.findById(crypto.randomUUID())).toBeNull();
  });

  it("update persiste le cycle de vie complet : processing (tentatives), puis completed avec l'image résultat", async () => {
    const job = newJob();
    await repository.save(job);
    const started = job.startProcessing();
    if (!isOk(started)) throw new Error("transition");
    await repository.update(started.value);
    expect((await repository.findById(job.id))?.props).toMatchObject({ status: "processing", attempts: 1 });

    const done = started.value.complete(imageId);
    if (!isOk(done)) throw new Error("transition");
    await repository.update(done.value);
    expect((await repository.findById(job.id))?.props).toMatchObject({ status: "completed", resultImageId: imageId });
  });

  it("update persiste un échec avec son type et son message", async () => {
    const job = newJob();
    await repository.save(job);
    const failed = job.fail("InvalidTransformation", "rotate invalide");
    if (!isOk(failed)) throw new Error("transition");
    await repository.update(failed.value);
    expect((await repository.findById(job.id))?.props).toMatchObject({ status: "failed", errorKind: "InvalidTransformation", errorMessage: "rotate invalide" });
  });

  it("delete supprime le job ; supprimer un job absent ne lève pas d'erreur", async () => {
    const job = newJob();
    await repository.save(job);
    await repository.delete(job.id);
    expect(await repository.findById(job.id)).toBeNull();
    await expect(repository.delete(job.id)).resolves.toBeUndefined();
  });

  it("la base refuse un statut hors énumération et un job dont l'image source n'existe pas", async () => {
    await expect(pool.query("UPDATE transform_jobs SET status = 'nimporte' WHERE false")).resolves.toBeDefined();
    const job = newJob();
    await repository.save(job);
    await expect(pool.query("UPDATE transform_jobs SET status = 'nimporte' WHERE id = $1", [job.id])).rejects.toThrow();
    const orphan = TransformJob.create({ ownerId, sourceImageId: crypto.randomUUID(), transformations: { rotate: 90 } });
    await expect(repository.save(orphan)).rejects.toThrow();
  });

  it("supprimer l'utilisateur supprime ses jobs (ON DELETE CASCADE)", async () => {
    const job = newJob();
    await repository.save(job);
    await pool.query("DELETE FROM users WHERE id = $1", [ownerId]);
    expect(await repository.findById(job.id)).toBeNull();
  });
});
