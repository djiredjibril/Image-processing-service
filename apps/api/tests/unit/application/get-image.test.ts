/** Tests unitaires du use case GetImage (fakes en mémoire). */
import { beforeEach, describe, expect, it } from "vitest";
import { GetImage } from "../../../src/application/use-cases/get-image.js";
import { UploadImage } from "../../../src/application/use-cases/upload-image.js";
import { isErr, isOk } from "../../../src/domain/shared/result.js";
import { FakeImageProcessor } from "../../fakes/fake-image-processor.js";
import { InMemoryFileStorage } from "../../fakes/in-memory-file-storage.js";
import { InMemoryImageRepository } from "../../fakes/in-memory-image-repository.js";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("contenu")]);

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

describe("GetImage", () => {
  let storage: InMemoryFileStorage;
  let images: InMemoryImageRepository;
  let useCase: GetImage;
  let imageId: string;

  beforeEach(async () => {
    storage = new InMemoryFileStorage();
    images = new InMemoryImageRepository();
    useCase = new GetImage(images, storage);
    const upload = new UploadImage(storage, new FakeImageProcessor(), images, { maxBytes: 1000, maxPixelsSide: 8000 });
    const uploaded = await upload.execute({ ownerId: "owner", data: JPEG });
    if (!isOk(uploaded)) throw new Error("upload de test échoué");
    imageId = uploaded.value.id;
  });

  it("renvoie un FLUX (pas un buffer), le type MIME et le poids pour le propriétaire", async () => {
    const result = await useCase.execute({ ownerId: "owner", imageId });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(typeof result.value.stream.pipe).toBe("function");
    expect(Buffer.isBuffer(result.value.stream)).toBe(false);
    expect(result.value.mimeType).toBe("image/jpeg");
    expect(result.value.sizeBytes).toBe(JPEG.byteLength);
    expect((await readAll(result.value.stream)).equals(JPEG)).toBe(true);
  });

  it("renvoie la MÊME erreur pour une image d'un autre utilisateur et pour une image inconnue", async () => {
    const other = await useCase.execute({ ownerId: "intrus", imageId });
    const unknown = await useCase.execute({ ownerId: "owner", imageId: "00000000-0000-4000-8000-000000000000" });
    expect(isErr(other) && other.error.kind).toBe("ImageNotFound");
    expect(other).toEqual(unknown);
  });

  it("renvoie ImageNotFound si la ligne existe mais que le fichier a disparu du stockage", async () => {
    storage.files.clear();
    const result = await useCase.execute({ ownerId: "owner", imageId });
    expect(isErr(result) && result.error.kind).toBe("ImageNotFound");
  });
});
