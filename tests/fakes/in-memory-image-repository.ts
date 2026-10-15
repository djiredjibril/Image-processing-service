/** Fake en mémoire de `IImageRepository` ; peut simuler une panne d'insertion. */
import type { Image } from "../../src/domain/entities/image.js";
import type { IImageRepository } from "../../src/domain/repositories/image-repository.js";

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
}
