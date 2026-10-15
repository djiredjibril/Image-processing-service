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
import { Pagination } from "../../src/domain/value-objects/pagination.js";
import { PasswordHash } from "../../src/domain/value-objects/password-hash.js";
import { StorageKey } from "../../src/domain/value-objects/storage-key.js";
import { PgImageRepository } from "../../src/infrastructure/persistence/pg-image-repository.js";
import { PgUserRepository } from "../../src/infrastructure/persistence/pg-user-repository.js";
import { createMigratedTestPool, resetTables } from "../helpers/test-db.js";

let pool: pg.Pool;
let repository: PgImageRepository;
let ownerId: string;

function pagination(page: number, limit: number): Pagination {
  const result = Pagination.create(page, limit);
  if (!isOk(result)) throw new Error("pagination de test invalide");
  return result.value;
}

function newImageAt(owner: string, createdAt: Date, id = crypto.randomUUID()): Image {
  const original = newImage(owner);
  return Image.restore({
    id,
    ownerId: original.ownerId,
    storageKey: original.storageKey,
    originalId: null,
    format: original.format,
    size: original.size,
    dimensions: original.dimensions,
    createdAt,
  });
}

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

  describe("listByOwner", () => {
    async function createOtherOwner(): Promise<string> {
      const email = Email.create("autre@example.com");
      if (!isOk(email)) throw new Error("email de test invalide");
      const other = User.create({ email: email.value, passwordHash: PasswordHash.fromHash("h") });
      await new PgUserRepository(pool).save(other);
      return other.id;
    }

    it("trie par date décroissante, pagine, et renvoie le total", async () => {
      for (let day = 1; day <= 5; day += 1) {
        await repository.save(newImageAt(ownerId, new Date(Date.UTC(2026, 0, day))));
      }

      const first = await repository.listByOwner(ownerId, pagination(1, 2));
      expect(first.total).toBe(5);
      expect(first.items.map((i) => i.createdAt.getUTCDate())).toEqual([5, 4]);

      const second = await repository.listByOwner(ownerId, pagination(2, 2));
      expect(second.items.map((i) => i.createdAt.getUTCDate())).toEqual([3, 2]);

      const last = await repository.listByOwner(ownerId, pagination(3, 2));
      expect(last.items.map((i) => i.createdAt.getUTCDate())).toEqual([1]);

      const beyond = await repository.listByOwner(ownerId, pagination(4, 2));
      expect(beyond).toEqual({ items: [], total: 5 });
    });

    it("départage les dates identiques par identifiant : l'ordre est stable d'un appel à l'autre", async () => {
      const sameDate = new Date(Date.UTC(2026, 0, 1));
      for (let i = 0; i < 6; i += 1) {
        await repository.save(newImageAt(ownerId, sameDate));
      }
      const ids = async (page: number): Promise<string[]> =>
        (await repository.listByOwner(ownerId, pagination(page, 3))).items.map((i) => i.id);

      const all = [...(await ids(1)), ...(await ids(2))];
      expect(new Set(all).size).toBe(6);
      expect(await ids(1)).toEqual(await ids(1));
    });

    it("n'inclut jamais les images (ni le total) d'un autre utilisateur", async () => {
      const otherId = await createOtherOwner();
      await repository.save(newImageAt(ownerId, new Date(Date.UTC(2026, 0, 1))));
      await repository.save(newImageAt(otherId, new Date(Date.UTC(2026, 0, 2))));
      await repository.save(newImageAt(otherId, new Date(Date.UTC(2026, 0, 3))));

      const mine = await repository.listByOwner(ownerId, pagination(1, 10));
      expect(mine.total).toBe(1);
      expect(mine.items.every((i) => i.ownerId === ownerId)).toBe(true);
    });

    it("renvoie une liste vide et un total de 0 sans image", async () => {
      expect(await repository.listByOwner(ownerId, pagination(1, 10))).toEqual({ items: [], total: 0 });
    });
  });
});
