/** Tests unitaires du use case TransformImage (fakes en mémoire, aucun disque ni sharp). */
import { beforeEach, describe, expect, it } from "vitest";
import { TransformImage } from "../../../src/application/use-cases/transform-image.js";
import { UploadImage } from "../../../src/application/use-cases/upload-image.js";
import { isErr, isOk } from "../../../src/domain/shared/result.js";
import { FakeImageProcessor } from "../../fakes/fake-image-processor.js";
import { InMemoryFileStorage } from "../../fakes/in-memory-file-storage.js";
import { InMemoryImageRepository } from "../../fakes/in-memory-image-repository.js";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("contenu")]);
const LIMITS = { maxPixelsSide: 8000 };

describe("TransformImage", () => {
  let storage: InMemoryFileStorage;
  let processor: FakeImageProcessor;
  let images: InMemoryImageRepository;
  let useCase: TransformImage;
  let sourceId: string;

  beforeEach(async () => {
    storage = new InMemoryFileStorage();
    processor = new FakeImageProcessor(); // la source est un JPEG de 100×50
    images = new InMemoryImageRepository();
    useCase = new TransformImage(images, storage, processor, LIMITS);
    const upload = new UploadImage(storage, processor, images, { maxBytes: 1000, maxPixelsSide: 8000 });
    const uploaded = await upload.execute({ ownerId: "owner", data: JPEG });
    if (!isOk(uploaded)) throw new Error("upload de test échoué");
    sourceId = uploaded.value.id;
  });

  const run = (transformations: Parameters<TransformImage["execute"]>[0]["transformations"], ownerId = "owner", imageId = sourceId) =>
    useCase.execute({ ownerId, imageId, transformations });

  it("crée un dérivé : nouvelle image, nouveau fichier sous derived/, original intact, originalId renseigné", async () => {
    const originalKey = [...storage.files.keys()][0];
    const result = await run({ rotate: 90 });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toMatchObject({ originalId: sourceId, format: "jpeg", width: 50, height: 25 });
    expect(result.value.id).not.toBe(sourceId);

    expect(storage.files.size).toBe(2);
    const keys = [...storage.files.keys()];
    expect(keys).toContain(originalKey);
    expect(keys.find((key) => key !== originalKey)).toMatch(/^derived\/[0-9a-f-]{36}\.jpg$/);
    expect(Buffer.from(storage.files.get(originalKey ?? "") ?? []).equals(JPEG)).toBe(true);
    expect(images.images).toHaveLength(2);
    expect(images.images.find((image) => image.id === sourceId)?.originalId).toBeNull();
  });

  it("transmet le filigrane au processeur ; un filigrane invalide est refusé avant tout traitement", async () => {
    const ok = await run({ watermark: { text: "© Moi", position: "top-left", opacity: 0.7 } });
    expect(isOk(ok)).toBe(true);
    expect(processor.transformCalls[0]?.transformations.watermark).toMatchObject({ text: "© Moi", position: "top-left", opacity: 0.7 });

    const refused = await run({ watermark: { text: "</text><script>" } });
    expect(isErr(refused) && refused.error.kind).toBe("InvalidTransformation");
    expect(processor.transformCalls).toHaveLength(1);
  });

  it("lit la source et transmet au processeur le contenu, les transformations et le format de sortie", async () => {
    await run({ rotate: 90, format: "webp" });
    expect(processor.transformCalls).toHaveLength(1);
    const call = processor.transformCalls[0];
    expect(Buffer.from(call?.data ?? []).equals(JPEG)).toBe(true);
    expect(call?.transformations.rotation?.degrees).toBe(90);
    expect(call?.outputFormat.name).toBe("webp");
  });

  it("le format de sortie par défaut est celui de la source ; le format demandé change l'extension du fichier", async () => {
    const same = await run({ flip: true });
    expect(isOk(same) && same.value.format).toBe("jpeg");

    const converted = await run({ format: "png" });
    expect(isOk(converted) && converted.value.format).toBe("png");
    expect([...storage.files.keys()].some((key) => /^derived\/.+\.png$/.test(key))).toBe(true);
  });

  it("transformer un dérivé donne un dérivé qui pointe vers l'ORIGINAL racine, pas vers le dérivé", async () => {
    const first = await run({ rotate: 90 });
    if (!isOk(first)) throw new Error("premier dérivé échoué");
    const second = await run({ flip: true }, "owner", first.value.id);
    expect(isOk(second) && second.value.originalId).toBe(sourceId);
    expect(storage.files.size).toBe(3);
  });

  it("renvoie la MÊME erreur pour une image d'un autre utilisateur et pour une image inconnue, sans rien traiter", async () => {
    const other = await run({ rotate: 90 }, "intrus");
    const unknown = await run({ rotate: 90 }, "owner", "00000000-0000-4000-8000-000000000000");
    expect(isErr(other) && other.error.kind).toBe("ImageNotFound");
    expect(other).toEqual(unknown);
    expect(processor.transformCalls).toHaveLength(0);
    expect(storage.files.size).toBe(1);
  });

  it("renvoie ImageNotFound si le fichier source a disparu du stockage", async () => {
    storage.files.clear();
    const result = await run({ rotate: 90 });
    expect(isErr(result) && result.error.kind).toBe("ImageNotFound");
  });

  it.each([
    ["aucune transformation", {}],
    ["rotation hors bornes", { rotate: 400 }],
    ["filtre inconnu", { filter: "blur" }],
    ["format inconnu", { format: "gif" }],
    ["resize au-delà de la limite", { resize: { width: 8001 } }],
    ["crop qui dépasse la source (100×50)", { crop: { x: 90, y: 0, width: 20, height: 10 } }],
    ["qualité sur une sortie PNG", { format: "png", quality: 80 }],
  ])("refuse sans traiter ni stocker : %s", async (_name, transformations) => {
    const result = await run(transformations);
    expect(isErr(result) && result.error.kind).toBe("InvalidTransformation");
    expect(processor.transformCalls).toHaveLength(0);
    expect(storage.files.size).toBe(1);
    expect(images.images).toHaveLength(1);
  });

  it("refuse un résultat plus grand que la limite par côté, sans rien stocker", async () => {
    processor.transformed = { width: 9000, height: 10, bytes: Uint8Array.from([1]) };
    const result = await run({ rotate: 45 });
    expect(isErr(result) && result.error.kind).toBe("InvalidTransformation");
    expect(storage.files.size).toBe(1);
    expect(images.images).toHaveLength(1);
  });

  it("accepte un résultat pile à la limite par côté", async () => {
    processor.transformed = { width: 8000, height: 1, bytes: Uint8Array.from([1]) };
    expect(isOk(await run({ rotate: 45 }))).toBe(true);
  });

  it("renvoie CorruptedImage si la source ne peut pas être décodée, sans rien stocker", async () => {
    processor.transformed = null;
    const result = await run({ rotate: 90 });
    expect(isErr(result) && result.error.kind).toBe("CorruptedImage");
    expect(storage.files.size).toBe(1);
    expect(images.images).toHaveLength(1);
  });

  it("COMPENSATION : si l'insertion du dérivé échoue, son fichier est supprimé, l'original reste, l'erreur est relancée", async () => {
    const originalKey = [...storage.files.keys()][0];
    images.failOnSave = true;
    await expect(run({ rotate: 90 })).rejects.toThrow("panne simulée");
    expect([...storage.files.keys()]).toEqual([originalKey]);
    expect(images.images).toHaveLength(1);
  });

  it("n'expose jamais la clé de stockage ni le propriétaire", async () => {
    const result = await run({ flip: true });
    expect(isOk(result) && Object.keys(result.value).sort()).toEqual(["createdAt", "format", "height", "id", "originalId", "sizeBytes", "width"]);
  });
});
