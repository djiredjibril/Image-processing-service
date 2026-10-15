/** Tests d'intégration de PgImageRepository contre `imageservice_test`. */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Image } from "../../src/domain/entities/image.js";
import { User } from "../../src/domain/entities/user.js";
import { isOk } from "../../src/domain/shared/result.js";
import { Email } from "../../src/domain/value-objects/email.js";
import { FileSize } from "../../src/domain/value-objects/file-size.js";
import { ImageDimensions } from "../../src/domain/value-objects/image-dimensions.js";
import { ImageFormat } from "../../src/domain/value-objects/image-format.js";
import { PasswordHash } from "../../src/domain/value-objects/password-hash.js";
import { StorageKey } from "../../src/domain/value-objects/storage-key.js";
import { PgImageRepository } from "../../src/infrastructure/persistence/pg-image-repository.js";
import { PgUserRepository } from "../../src/infrastructure/persistence/pg-user-repository.js";
import { createMigratedTestPool, resetTables } from "../helpers/test-db.js";

let pool: pg.Pool;
let repository: PgImageRepository;
let ownerId: string;

function newImage(owner: string): Image {
  const size = FileSize.create(1234);
  const dimensions = ImageDimensions.create(640, 480);
  if (!isOk(size) || !isOk(dimensions)) throw new Error("valeurs de test invalides");
  return Image.createOriginal({
    ownerId: owner,
    storageKey: StorageKey.forOriginal(ImageFormat.PNG),
    format: ImageFormat.PNG,
    size: size.value,
    dimensions: dimensions.value,
  });
}

beforeAll(async () => {
  pool = await createMigratedTestPool();
  repository = new PgImageRepository(pool);
});
beforeEach(async () => {
  await resetTables(pool);
  const email = Email.create("owner@example.com");
  if (!isOk(email)) throw new Error("email de test invalide");
  const user = User.create({ email: email.value, passwordHash: PasswordHash.fromHash("h") });
  await new PgUserRepository(pool).save(user);
  ownerId = user.id;
});
afterAll(async () => {
  await pool.end();
});

describe("PgImageRepository", () => {
  it("save puis findById restitue la même image", async () => {
    const image = newImage(ownerId);
    await repository.save(image);

    const found = await repository.findById(image.id);
    expect(found?.id).toBe(image.id);
    expect(found?.ownerId).toBe(ownerId);
    expect(found?.storageKey.value).toBe(image.storageKey.value);
    expect(found?.originalId).toBeNull();
    expect(found?.format).toBe(ImageFormat.PNG);
    expect(found?.size.bytes).toBe(1234);
    expect(found?.dimensions.width).toBe(640);
  });

  it("findById renvoie null si introuvable", async () => {
    expect(await repository.findById("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("refuse une image dont le propriétaire n'existe pas (clé étrangère)", async () => {
    await expect(repository.save(newImage("00000000-0000-4000-8000-000000000000"))).rejects.toThrow();
  });
});
