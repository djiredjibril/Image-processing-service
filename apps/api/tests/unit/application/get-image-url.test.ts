/** Tests unitaires de GetImageUrl (fakes en mémoire). */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GetImageUrl } from "../../../src/application/use-cases/get-image-url.js";
import { UploadImage } from "../../../src/application/use-cases/upload-image.js";
import { isErr, isOk } from "../../../src/domain/shared/result.js";
import { FakeFileUrlSigner } from "../../fakes/fake-file-url-signer.js";
import { FakeImageProcessor } from "../../fakes/fake-image-processor.js";
import { InMemoryFileStorage } from "../../fakes/in-memory-file-storage.js";
import { InMemoryImageRepository } from "../../fakes/in-memory-image-repository.js";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("contenu")]);

describe("GetImageUrl", () => {
  let storage: InMemoryFileStorage;
  let images: InMemoryImageRepository;
  let signer: FakeFileUrlSigner;
  let sourceId: string;

  beforeEach(async () => {
    storage = new InMemoryFileStorage();
    images = new InMemoryImageRepository();
    signer = new FakeFileUrlSigner();
    const uploaded = await new UploadImage(storage, new FakeImageProcessor(), images, { maxBytes: 1000, maxPixelsSide: 8000 }).execute({ ownerId: "owner", data: JPEG });
    if (!isOk(uploaded)) throw new Error("upload de test échoué");
    sourceId = uploaded.value.id;
  });

  it("délivre l'URL signée de la clé de l'image, avec la durée configurée et la date d'expiration", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    try {
      const result = await new GetImageUrl(images, storage, signer, 120).execute({ ownerId: "owner", imageId: sourceId });
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      const key = images.images[0]?.storageKey.value ?? "";
      expect(result.value.url).toBe(`https://storage.example/${key}?ttl=120`);
      expect(result.value.expiresInSeconds).toBe(120);
      expect(result.value.expiresAt.toISOString()).toBe("2026-01-01T00:02:00.000Z");
      expect(signer.calls).toEqual([{ key, ttlSeconds: 120 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("image d'un autre utilisateur ou inconnue : ImageNotFound, et RIEN n'est signé", async () => {
    const useCase = new GetImageUrl(images, storage, signer, 60);
    for (const [ownerId, imageId] of [["intruder", sourceId], ["owner", "inconnue"]] as const) {
      const result = await useCase.execute({ ownerId, imageId });
      expect(isErr(result) && result.error.kind).toBe("ImageNotFound");
    }
    expect(signer.calls).toHaveLength(0);
  });

  it("stockage sans URLs signées (signeur nul) : PresignedUrlsUnsupported", async () => {
    const result = await new GetImageUrl(images, storage, null, 60).execute({ ownerId: "owner", imageId: sourceId });
    expect(isErr(result) && result.error.kind).toBe("PresignedUrlsUnsupported");
  });

  it("sans signeur, une image d'AUTRUI reste « introuvable » (l'autorisation passe avant la capacité du stockage)", async () => {
    const result = await new GetImageUrl(images, storage, null, 60).execute({ ownerId: "intruder", imageId: sourceId });
    expect(isErr(result) && result.error.kind).toBe("ImageNotFound");
  });

  it("fichier absent du stockage alors que la ligne existe : ImageNotFound, rien n'est signé", async () => {
    storage.files.clear();
    const result = await new GetImageUrl(images, storage, signer, 60).execute({ ownerId: "owner", imageId: sourceId });
    expect(isErr(result) && result.error.kind).toBe("ImageNotFound");
    expect(signer.calls).toHaveLength(0);
  });
});
