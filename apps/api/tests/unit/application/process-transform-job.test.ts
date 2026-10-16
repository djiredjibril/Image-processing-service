/** Tests unitaires de ProcessTransformJob (fakes en mémoire) : succès, échec métier, panne technique, idempotence. */
import { beforeEach, describe, expect, it } from "vitest";
import { PROCESSING_FAILED, ProcessTransformJob } from "../../../src/application/use-cases/process-transform-job.js";
import { TransformImage } from "../../../src/application/use-cases/transform-image.js";
import { UploadImage } from "../../../src/application/use-cases/upload-image.js";
import { TransformJob } from "../../../src/domain/entities/transform-job.js";
import { isErr, isOk } from "../../../src/domain/shared/result.js";
import type { RawTransformationInput } from "../../../src/domain/value-objects/transformation-set.js";
import { FakeImageProcessor } from "../../fakes/fake-image-processor.js";
import { InMemoryFileStorage } from "../../fakes/in-memory-file-storage.js";
import { InMemoryImageRepository } from "../../fakes/in-memory-image-repository.js";
import { InMemoryTransformCache } from "../../fakes/in-memory-transform-cache.js";
import { InMemoryTransformJobRepository } from "../../fakes/in-memory-transform-job-repository.js";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("contenu")]);

describe("ProcessTransformJob", () => {
  let images: InMemoryImageRepository;
  let jobs: InMemoryTransformJobRepository;
  let processor: FakeImageProcessor;
  let useCase: ProcessTransformJob;
  let sourceId: string;

  beforeEach(async () => {
    const storage = new InMemoryFileStorage();
    processor = new FakeImageProcessor();
    images = new InMemoryImageRepository();
    jobs = new InMemoryTransformJobRepository();
    const transform = new TransformImage(images, storage, processor, new InMemoryTransformCache(), { maxPixelsSide: 8000 });
    useCase = new ProcessTransformJob(jobs, transform);
    const uploaded = await new UploadImage(storage, processor, images, { maxBytes: 1000, maxPixelsSide: 8000 }).execute({ ownerId: "owner", data: JPEG });
    if (!isOk(uploaded)) throw new Error("upload de test échoué");
    sourceId = uploaded.value.id;
  });

  async function queued(transformations: RawTransformationInput, ownerId = "owner", imageId = sourceId): Promise<TransformJob> {
    const job = TransformJob.create({ ownerId, sourceImageId: imageId, transformations });
    await jobs.save(job);
    return job;
  }
  const stored = (id: string): TransformJob => {
    const job = jobs.jobs.get(id);
    if (job === undefined) throw new Error("job absent");
    return job;
  };

  it("succès : le job passe completed avec l'id du dérivé, qui existe en base et descend de la source", async () => {
    const job = await queued({ rotate: 90 });
    const result = await useCase.execute(job.id);

    expect(result).toMatchObject({ ok: true, value: "completed" });
    const done = stored(job.id);
    expect(done.status).toBe("completed");
    expect(done.props.attempts).toBe(1);
    const derived = images.images.find((image) => image.id === done.props.resultImageId);
    expect(derived?.originalId).toBe(sourceId);
    expect(derived?.ownerId).toBe("owner");
  });

  it("échec MÉTIER : le job passe failed tout de suite avec un message client, sans lever d'erreur (pas de nouvelle tentative)", async () => {
    const job = await queued({ rotate: 45.5 });
    const result = await useCase.execute(job.id);

    expect(result).toMatchObject({ ok: true, value: "failed" });
    expect(stored(job.id).props).toMatchObject({ status: "failed", errorKind: "InvalidTransformation" });
    expect(stored(job.id).props.errorMessage).toContain("rotate");
    expect(images.images).toHaveLength(1); // aucun dérivé créé
  });

  it("image source d'un autre utilisateur : failed ImageNotFound (le propriétaire du JOB fait foi)", async () => {
    const job = await queued({ rotate: 90 }, "intruder");
    await useCase.execute(job.id);
    expect(stored(job.id).props).toMatchObject({ status: "failed", errorKind: "ImageNotFound" });
  });

  it("panne TECHNIQUE : l'exception remonte (la file réessaiera) et le job reste processing, pas failed", async () => {
    const job = await queued({ rotate: 90 });
    images.failOnSave = true;
    await expect(useCase.execute(job.id)).rejects.toThrow("panne simulée");
    expect(stored(job.id).status).toBe("processing");
    expect(stored(job.id).props.attempts).toBe(1);
  });

  it("nouvelle tentative après une panne passagère : réussit et compte 2 tentatives", async () => {
    const job = await queued({ rotate: 90 });
    images.failNextSaves = 1;
    await expect(useCase.execute(job.id)).rejects.toThrow();
    const second = await useCase.execute(job.id);
    expect(second).toMatchObject({ ok: true, value: "completed" });
    expect(stored(job.id).props.attempts).toBe(2);
  });

  it("idempotent : un job déjà terminé (livré deux fois) n'est pas retraité", async () => {
    const job = await queued({ rotate: 90 });
    await useCase.execute(job.id);
    const count = images.images.length;
    expect(await useCase.execute(job.id)).toMatchObject({ ok: true, value: "already-finished" });
    expect(images.images).toHaveLength(count);
    expect(processor.transformCalls).toHaveLength(1);
  });

  it("job inexistant : Err(JobNotFound), rien n'est traité", async () => {
    const result = await useCase.execute("00000000-0000-4000-8000-000000000000");
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("JobNotFound");
  });

  it("recordFinalFailure : passe failed avec un message GÉNÉRIQUE (aucun détail interne) ; sans effet sur un job terminé", async () => {
    const job = await queued({ rotate: 90 });
    await useCase.recordFinalFailure(job.id);
    expect(stored(job.id).props).toMatchObject({ status: "failed", errorKind: PROCESSING_FAILED });
    expect(stored(job.id).props.errorMessage).not.toMatch(/sql|postgres|panne simulée/i);

    const done = await queued({ rotate: 90 });
    await useCase.execute(done.id);
    await useCase.recordFinalFailure(done.id);
    expect(stored(done.id).status).toBe("completed");
    await expect(useCase.recordFinalFailure("00000000-0000-4000-8000-000000000000")).resolves.toBeUndefined();
  });
});
