/** Fake en mémoire de `IImageRepository` ; peut simuler une panne d'insertion. */
import type { Image } from "../../src/domain/entities/image.js";
import type { Pagination } from "../../src/domain/value-objects/pagination.js";
import type { IImageRepository, ImagePage } from "../../src/domain/repositories/image-repository.js";

/** Repository en mémoire. Mettre `failOnSave` pour simuler une panne de la base. */
export class InMemoryImageRepository implements IImageRepository {
  readonly images: Image[] = [];
  failOnSave = false;

  save(image: Image): Promise<void> {
    if (this.failOnSave) {
      return Promise.reject(new Error("panne simulée de la base"));
    }
    this.images.push(image);
    return Promise.resolve();
  }

  findById(id: string): Promise<Image | null> {
    return Promise.resolve(this.images.find((image) => image.id === id) ?? null);
  }

  listByOwner(ownerId: string, pagination: Pagination): Promise<ImagePage> {
    const mine = this.images
      .filter((image) => image.ownerId === ownerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    return Promise.resolve({ items: mine.slice(pagination.offset, pagination.offset + pagination.limit), total: mine.length });
  }
}
