/** Tests unitaires du use case UploadImage (fakes en mémoire, aucune DB ni disque). */
import { beforeEach, describe, expect, it } from "vitest";
import { UploadImage } from "../../../src/application/use-cases/upload-image.js";
import { isErr, isOk } from "../../../src/domain/shared/result.js";
import { FakeImageProcessor } from "../../fakes/fake-image-processor.js";
import { InMemoryFileStorage } from "../../fakes/in-memory-file-storage.js";
import { InMemoryImageRepository } from "../../fakes/in-memory-image-repository.js";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("contenu")]);
const LIMITS = { maxBytes: 1000, maxPixelsSide: 8000 };

describe("UploadImage", () => {
  let storage: InMemoryFileStorage;
  let processor: FakeImageProcessor;
  let images: InMemoryImageRepository;
  let useCase: UploadImage;

  beforeEach(() => {
    storage = new InMemoryFileStorage();
    processor = new FakeImageProcessor();
    images = new InMemoryImageRepository();
    useCase = new UploadImage(storage, processor, images, LIMITS);
  });

  it("stocke le fichier sous originals/<uuid>.jpg, enregistre la ligne et renvoie les métadonnées publiques", async () => {
    const result = await useCase.execute({ ownerId: "user-1", data: JPEG });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(Object.keys(result.value).sort()).toEqual(["createdAt", "format", "height", "id", "sizeBytes", "width"]);
    expect(result.value).toMatchObject({ format: "jpeg", sizeBytes: JPEG.byteLength, width: 100, height: 50 });

    expect([...storage.files.keys()]).toHaveLength(1);
    expect([...storage.files.keys()][0]).toMatch(/^originals\/[0-9a-f-]{36}\.jpg$/);
    expect(images.images[0]?.ownerId).toBe("user-1");
    expect(images.images[0]?.originalId).toBeNull();
  });

  it("refuse un fichier vide", async () => {
    const result = await useCase.execute({ ownerId: "u", data: new Uint8Array() });
    expect(isErr(result) && result.error.kind).toBe("EmptyFile");
  });

  it("refuse un fichier trop lourd AVANT toute analyse (poids avant type)", async () => {
    const result = await useCase.execute({ ownerId: "u", data: Buffer.alloc(1001) });
    expect(isErr(result) && result.error.kind).toBe("FileTooLarge");
    expect(processor.calls).toBe(0);
  });

  it("accepte un fichier pile à la limite de poids", async () => {
    const data = Buffer.concat([JPEG, Buffer.alloc(1000 - JPEG.byteLength)]);
    expect(isOk(await useCase.execute({ ownerId: "u", data }))).toBe(true);
  });

  it("refuse un contenu qui n'est pas une image supportée, sans appeler sharp ni écrire", async () => {
    const result = await useCase.execute({ ownerId: "u", data: Buffer.from("GIF89a....") });
    expect(isErr(result) && result.error.kind).toBe("UnsupportedImageFormat");
    expect(processor.calls).toBe(0);
    expect(storage.files.size).toBe(0);
  });

  it("refuse une image illisible, ou dont le décodeur contredit les magic bytes", async () => {
    processor.metadata = null;
    const unreadable = await useCase.execute({ ownerId: "u", data: JPEG });
    expect(isErr(unreadable) && unreadable.error.kind).toBe("CorruptedImage");

    processor.metadata = { format: "png", width: 10, height: 10 };
    const mismatch = await useCase.execute({ ownerId: "u", data: JPEG });
    expect(isErr(mismatch) && mismatch.error.kind).toBe("CorruptedImage");
    expect(storage.files.size).toBe(0);
  });

  it("refuse une image trop grande sur un côté, accepte pile la limite", async () => {
    processor.metadata = { format: "jpeg", width: 8001, height: 10 };
    const tooWide = await useCase.execute({ ownerId: "u", data: JPEG });
    expect(isErr(tooWide) && tooWide.error.kind).toBe("ImageDimensionsTooLarge");
    expect(storage.files.size).toBe(0);

    processor.metadata = { format: "jpeg", width: 10, height: 8000 };
    expect(isOk(await useCase.execute({ ownerId: "u", data: JPEG }))).toBe(true);
  });

  it("COMPENSATION : si l'insertion en base échoue, le fichier écrit est supprimé et l'erreur relancée", async () => {
    images.failOnSave = true;
    await expect(useCase.execute({ ownerId: "u", data: JPEG })).rejects.toThrow("panne simulée");
    expect(storage.files.size).toBe(0);
    expect(images.images).toHaveLength(0);
  });
});
