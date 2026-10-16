/** Tests unitaires du use case TransformImage (fakes en mémoire, aucun disque ni sharp). */
import { beforeEach, describe, expect, it } from "vitest";
import { TransformImage } from "../../../src/application/use-cases/transform-image.js";
import { UploadImage } from "../../../src/application/use-cases/upload-image.js";
import { isErr, isOk } from "../../../src/domain/shared/result.js";
import { LocalWorkSlots } from "../../../src/infrastructure/concurrency/local-work-slots.js";
import { InMemoryTransformCache, UnavailableTransformCache } from "../../fakes/in-memory-transform-cache.js";
import { FakeImageProcessor } from "../../fakes/fake-image-processor.js";
import { InMemoryFileStorage } from "../../fakes/in-memory-file-storage.js";
import { InMemoryImageRepository } from "../../fakes/in-memory-image-repository.js";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("contenu")]);
const LIMITS = { maxPixelsSide: 8000 };

describe("TransformImage", () => {
  let storage: InMemoryFileStorage;
  let processor: FakeImageProcessor;
  let images: InMemoryImageRepository;
  let cache: InMemoryTransformCache;
  let useCase: TransformImage;
  let sourceId: string;

  beforeEach(async () => {
    storage = new InMemoryFileStorage();
    processor = new FakeImageProcessor(); // la source est un JPEG de 100×50
    images = new InMemoryImageRepository();
    cache = new InMemoryTransformCache();
    useCase = new TransformImage(images, storage, processor, cache, LIMITS);
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
    expect(result.value.cached).toBe(false);
    expect(result.value.image).toMatchObject({ originalId: sourceId, format: "jpeg", width: 50, height: 25 });
    expect(result.value.image.id).not.toBe(sourceId);

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
    expect(isOk(same) && same.value.image.format).toBe("jpeg");

    const converted = await run({ format: "png" });
    expect(isOk(converted) && converted.value.image.format).toBe("png");
    expect([...storage.files.keys()].some((key) => /^derived\/.+\.png$/.test(key))).toBe(true);
  });

  it("transformer un dérivé donne un dérivé qui pointe vers l'ORIGINAL racine, pas vers le dérivé", async () => {
    const first = await run({ rotate: 90 });
    if (!isOk(first)) throw new Error("premier dérivé échoué");
    const second = await run({ flip: true }, "owner", first.value.image.id);
    expect(isOk(second) && second.value.image.originalId).toBe(sourceId);
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
    expect(isOk(result) && Object.keys(result.value.image).sort()).toEqual(["createdAt", "format", "height", "id", "originalId", "sizeBytes", "width"]);
  });

  describe("cache", () => {
    it("MISS puis HIT : la 2e demande identique renvoie le même dérivé, sans retraiter ni créer de fichier ni de ligne", async () => {
      const first = await run({ rotate: 90, filter: "sepia" });
      expect(isOk(first) && first.value.cached).toBe(false);
      const filesAfterFirst = storage.files.size;

      const second = await run({ rotate: 90, filter: "sepia" });
      expect(isOk(second) && second.value.cached).toBe(true);
      expect(isOk(first) && isOk(second) && second.value.image).toEqual(isOk(first) ? first.value.image : null);
      expect(processor.transformCalls).toHaveLength(1);
      expect(storage.files.size).toBe(filesAfterFirst);
      expect(images.images).toHaveLength(2); // l'original + UN seul dérivé
    });

    it("des paramètres équivalents (valeurs par défaut explicites, rotation -90° ≡ 270°) donnent un HIT", async () => {
      await run({ rotate: 270, resize: { width: 10 } });
      const again = await run({ rotate: -90, resize: { width: 10, fit: "inside" }, flip: false });
      expect(isOk(again) && again.value.cached).toBe(true);
      expect(processor.transformCalls).toHaveLength(1);
    });

    it("des paramètres différents donnent un nouveau MISS et un nouveau dérivé", async () => {
      await run({ rotate: 90 });
      const other = await run({ rotate: 180 });
      expect(isOk(other) && other.value.cached).toBe(false);
      expect(processor.transformCalls).toHaveLength(2);
      expect(images.images).toHaveLength(3);
    });

    it("n'écrit dans le cache qu'après l'enregistrement du dérivé : la clé pointe vers une ligne qui existe", async () => {
      const result = await run({ rotate: 90 });
      const derivedId = isOk(result) ? result.value.image.id : "";
      expect([...cache.entries.values()]).toEqual([derivedId]);
      expect(images.images.some((image) => image.id === derivedId)).toBe(true);
    });

    it("ne met rien en cache pour une demande invalide, une source illisible ou une panne de la base", async () => {
      await run({ rotate: 999 });
      processor.transformed = null;
      await run({ rotate: 90 });
      processor.transformed = { width: 50, height: 25, bytes: Uint8Array.from([9]) };
      images.failOnSave = true;
      await expect(run({ rotate: 90 })).rejects.toThrow();
      expect(cache.entries.size).toBe(0);
    });

    it("ignore une entrée PÉRIMÉE (dérivé supprimé) et recalcule, puis remplace l'entrée", async () => {
      const first = await run({ rotate: 90 });
      const staleId = isOk(first) ? first.value.image.id : "";
      images.images.splice(images.images.findIndex((image) => image.id === staleId), 1);

      const again = await run({ rotate: 90 });
      expect(isOk(again) && again.value.cached).toBe(false);
      expect(isOk(again) && again.value.image.id).not.toBe(staleId);
      expect(processor.transformCalls).toHaveLength(2);
      expect([...cache.entries.values()]).toEqual([isOk(again) ? again.value.image.id : ""]);
    });

    it("ignore une entrée EMPOISONNÉE : dérivé d'un autre utilisateur ou d'une autre racine", async () => {
      const mine = await run({ rotate: 90 });
      const myDerived = images.images.find((image) => isOk(mine) && image.id === mine.value.image.id);
      if (myDerived === undefined) throw new Error("dérivé introuvable");
      const key = [...cache.entries.keys()][0] ?? "";

      // Le cache désigne l'image d'un AUTRE utilisateur (ou l'original lui-même, dont originalId vaut null).
      for (const poisoned of [sourceId, myDerived.id]) {
        cache.entries.set(key, poisoned);
        processor.transformCalls.length = 0;
        const result = await useCase.execute({ ownerId: "owner", imageId: sourceId, transformations: { rotate: 90 } });
        if (poisoned === sourceId) {
          // le « dérivé » désigné est l'original : originalId null ≠ racine → entrée refusée
          expect(isOk(result) && result.value.cached).toBe(false);
          expect(processor.transformCalls).toHaveLength(1);
        }
      }
      const other = await useCase.execute({ ownerId: "intrus", imageId: sourceId, transformations: { rotate: 90 } });
      expect(isErr(other) && other.error.kind).toBe("ImageNotFound");
    });

    it("la clé dépend de l'utilisateur : le cache d'un utilisateur ne sert jamais un autre", async () => {
      await run({ rotate: 90 });
      const bobUpload = new UploadImage(storage, processor, images, { maxBytes: 1000, maxPixelsSide: 8000 });
      const bobSource = await bobUpload.execute({ ownerId: "bob", data: JPEG });
      if (!isOk(bobSource)) throw new Error("upload de test échoué");
      const bob = await useCase.execute({ ownerId: "bob", imageId: bobSource.value.id, transformations: { rotate: 90 } });
      expect(isOk(bob) && bob.value.cached).toBe(false);
    });

    it("VERROU : deux demandes identiques SIMULTANÉES ne créent qu'un seul dérivé ; la seconde attend et reçoit le même", async () => {
      let release: () => void = () => undefined;
      processor.transformGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = processor.nextTransformStarted();

      const first = run({ rotate: 90 });
      await started; // la 1re est en plein traitement et détient le verrou
      const second = run({ rotate: 90 });
      await new Promise((resolve) => setTimeout(resolve, 20)); // la 2e est bien en attente, elle n'a pas démarré de traitement
      expect(processor.transformCalls).toHaveLength(1);

      release();
      const [a, b] = await Promise.all([first, second]);
      expect(isOk(a) && isOk(b) && a.value.image.id === b.value.image.id).toBe(true);
      expect([isOk(a) && a.value.cached, isOk(b) && b.value.cached].sort()).toEqual([false, true]);
      expect(processor.transformCalls).toHaveLength(1);
      expect(images.images).toHaveLength(2);
      expect(cache.lockedKeys.size).toBe(0);
    });

    it("VERROU : cinq demandes identiques simultanées → un seul traitement, un seul dérivé", async () => {
      let release: () => void = () => undefined;
      processor.transformGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = processor.nextTransformStarted();
      const all = [run({ flip: true })];
      await started;
      for (let i = 0; i < 4; i += 1) all.push(run({ flip: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      release();

      const results = await Promise.all(all);
      expect(new Set(results.map((r) => (isOk(r) ? r.value.image.id : ""))).size).toBe(1);
      expect(results.filter((r) => isOk(r) && !r.value.cached)).toHaveLength(1);
      expect(processor.transformCalls).toHaveLength(1);
      expect(images.images).toHaveLength(2);
    });

    it("le verrou est libéré quand le traitement échoue : la demande suivante peut réessayer", async () => {
      processor.transformed = null;
      const failed = await run({ rotate: 90 });
      expect(isErr(failed) && failed.error.kind).toBe("CorruptedImage");
      expect(cache.lockedKeys.size).toBe(0);

      processor.transformed = { width: 50, height: 25, bytes: Uint8Array.from([9]) };
      expect(isOk(await run({ rotate: 90 }))).toBe(true);
    });

    it("le verrou est libéré aussi quand la base tombe en panne (exception)", async () => {
      images.failOnSave = true;
      await expect(run({ rotate: 90 })).rejects.toThrow("panne simulée");
      expect(cache.lockedKeys.size).toBe(0);
    });

    it("si le détenteur du verrou échoue, l'attendant ne reste pas bloqué : il recalcule lui-même", async () => {
      let release: () => void = () => undefined;
      processor.transformGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      processor.transformed = null; // le 1er traitement va échouer
      const started = processor.nextTransformStarted();
      const first = run({ rotate: 90 });
      await started;
      const second = run({ rotate: 90 });
      await new Promise((resolve) => setTimeout(resolve, 20));

      processor.transformed = { width: 50, height: 25, bytes: Uint8Array.from([9]) };
      release();
      const [a, b] = await Promise.all([first, second]);
      expect(isErr(a) && a.error.kind).toBe("CorruptedImage");
      expect(isOk(b) && b.value.cached).toBe(false);
    });

    it("FAIL-OPEN : si le cache est indisponible, la transformation fonctionne (sans dédoublonnage)", async () => {
      const unavailable = new TransformImage(images, storage, processor, new UnavailableTransformCache(), LIMITS);
      const first = await unavailable.execute({ ownerId: "owner", imageId: sourceId, transformations: { rotate: 90 } });
      const second = await unavailable.execute({ ownerId: "owner", imageId: sourceId, transformations: { rotate: 90 } });
      expect(isOk(first) && first.value.cached).toBe(false);
      expect(isOk(second) && second.value.cached).toBe(false);
      expect(processor.transformCalls).toHaveLength(2);
    });

    it("un résultat refusé (trop grand) n'est pas mis en cache, et l'autorisation passe AVANT le cache", async () => {
      processor.transformed = { width: 9000, height: 10, bytes: Uint8Array.from([1]) };
      const refused = await run({ rotate: 45 });
      expect(isErr(refused) && refused.error.kind).toBe("InvalidTransformation");
      expect(cache.entries.size).toBe(0);

      processor.transformed = { width: 50, height: 25, bytes: Uint8Array.from([9]) };
      await run({ rotate: 90 });
      const stranger = await run({ rotate: 90 }, "intrus");
      expect(isErr(stranger) && stranger.error.kind).toBe("ImageNotFound");
    });
  });

  describe("plafond de traitements simultanés", () => {
    const withSlots = (max: number): TransformImage => new TransformImage(images, storage, processor, cache, LIMITS, new LocalWorkSlots(max));

    async function saturate(max: number): Promise<{ limited: TransformImage; release: () => void; first: ReturnType<TransformImage["execute"]> }> {
      const limited = withSlots(max);
      let release: () => void = () => undefined;
      processor.transformGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = processor.nextTransformStarted();
      const first = limited.execute({ ownerId: "owner", imageId: sourceId, transformations: { rotate: 90 } });
      await started;
      return { limited, release, first };
    }

    it("refuse avec ServerBusy (sans traitement) quand le plafond est atteint et que la réponse n'est pas en cache", async () => {
      const { limited, release, first } = await saturate(1);
      const refused = await limited.execute({ ownerId: "owner", imageId: sourceId, transformations: { rotate: 180 } });
      expect(isErr(refused) && refused.error.kind).toBe("ServerBusy");
      expect(processor.transformCalls).toHaveLength(1);
      release();
      expect(isOk(await first)).toBe(true);
    });

    it("une réponse DÉJÀ en cache n'est jamais refusée, même plafond saturé (le cache ne coûte pas de place)", async () => {
      const limited = withSlots(1);
      expect(isOk(await limited.execute({ ownerId: "owner", imageId: sourceId, transformations: { rotate: 90 } }))).toBe(true);
      let release: () => void = () => undefined;
      processor.transformGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = processor.nextTransformStarted();
      const busy = limited.execute({ ownerId: "owner", imageId: sourceId, transformations: { rotate: 180 } });
      await started; // plafond saturé par un autre calcul

      const hit = await limited.execute({ ownerId: "owner", imageId: sourceId, transformations: { rotate: 90 } });
      expect(isOk(hit) && hit.value.cached).toBe(true);
      release();
      await busy;
    });

    it("rend la place après un succès, un échec métier ET une panne technique", async () => {
      const limited = withSlots(1);
      expect(isOk(await limited.execute({ ownerId: "owner", imageId: sourceId, transformations: { rotate: 90 } }))).toBe(true);
      processor.transformed = null; // sharp répond « image illisible » (échec métier)
      expect(isErr(await limited.execute({ ownerId: "owner", imageId: sourceId, transformations: { rotate: 180 } }))).toBe(true);
      processor.transformed = { width: 5, height: 5, bytes: Uint8Array.from([1]) };
      images.failOnSave = true; // panne de base : le use case lève une exception
      await expect(limited.execute({ ownerId: "owner", imageId: sourceId, transformations: { rotate: 270 } })).rejects.toThrow();
      images.failOnSave = false;
      const after = await limited.execute({ ownerId: "owner", imageId: sourceId, transformations: { flip: true } });
      expect(isOk(after)).toBe(true); // si une place avait fuité, ce serait ServerBusy
    });

    it("le refus libère aussi le verrou du cache : une demande identique ultérieure peut calculer", async () => {
      const { limited, release, first } = await saturate(1);
      await limited.execute({ ownerId: "owner", imageId: sourceId, transformations: { rotate: 180 } }); // refusée
      release();
      await first;
      processor.transformGate = null;
      const retry = await limited.execute({ ownerId: "owner", imageId: sourceId, transformations: { rotate: 180 } });
      expect(isOk(retry)).toBe(true);
    });
  });
});

