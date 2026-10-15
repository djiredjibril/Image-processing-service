/** Tests unitaires du use case ListImages (fakes en mémoire). */
import { beforeEach, describe, expect, it } from "vitest";
import { ListImages } from "../../../src/application/use-cases/list-images.js";
import { Image } from "../../../src/domain/entities/image.js";
import { isErr, isOk } from "../../../src/domain/shared/result.js";
import { FileSize } from "../../../src/domain/value-objects/file-size.js";
import { ImageDimensions } from "../../../src/domain/value-objects/image-dimensions.js";
import { ImageFormat } from "../../../src/domain/value-objects/image-format.js";
import { StorageKey } from "../../../src/domain/value-objects/storage-key.js";
import { InMemoryImageRepository } from "../../fakes/in-memory-image-repository.js";

function imageAt(ownerId: string, createdAt: Date): Image {
  const size = FileSize.create(100);
  const dimensions = ImageDimensions.create(10, 10);
  if (!isOk(size) || !isOk(dimensions)) throw new Error("valeurs de test invalides");
  return Image.restore({
    id: crypto.randomUUID(),
    ownerId,
    storageKey: StorageKey.forOriginal(ImageFormat.JPEG),
    originalId: null,
    format: ImageFormat.JPEG,
    size: size.value,
    dimensions: dimensions.value,
    createdAt,
  });
}

describe("ListImages", () => {
  let images: InMemoryImageRepository;
  let useCase: ListImages;

  beforeEach(async () => {
    images = new InMemoryImageRepository();
    useCase = new ListImages(images);
    for (let day = 1; day <= 12; day += 1) {
      await images.save(imageAt("alice", new Date(Date.UTC(2026, 0, day))));
    }
    await images.save(imageAt("bob", new Date(Date.UTC(2026, 5, 1))));
  });

  it("renvoie { items, page, limit, total }, la plus récente d'abord, sans les images d'un autre utilisateur", async () => {
    const result = await useCase.execute({ ownerId: "alice", page: 1, limit: 10 });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toMatchObject({ page: 1, limit: 10, total: 12 });
    expect(result.value.items).toHaveLength(10);
    const dates = result.value.items.map((item) => item.createdAt.getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it("la page 2 contient le reste, et une page au-delà de la fin est vide avec le bon total", async () => {
    const second = await useCase.execute({ ownerId: "alice", page: 2, limit: 10 });
    expect(isOk(second) && second.value.items).toHaveLength(2);
    const beyond = await useCase.execute({ ownerId: "alice", page: 99, limit: 10 });
    expect(isOk(beyond) && beyond.value).toMatchObject({ items: [], total: 12 });
  });

  it("n'expose jamais la clé de stockage ni le propriétaire", async () => {
    const result = await useCase.execute({ ownerId: "bob", page: 1, limit: 10 });
    expect(isOk(result) && Object.keys(result.value.items[0] ?? {}).sort()).toEqual(["createdAt", "format", "height", "id", "sizeBytes", "width"]);
  });

  it("refuse une pagination hors bornes", async () => {
    for (const [page, limit] of [[0, 10], [1, 51], [1, 0]] as const) {
      const result = await useCase.execute({ ownerId: "alice", page, limit });
      expect(isErr(result) && result.error.kind).toBe("InvalidPagination");
    }
  });
});
