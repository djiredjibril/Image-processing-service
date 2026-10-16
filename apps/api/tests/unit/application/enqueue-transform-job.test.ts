/** Tests unitaires de EnqueueTransformJob et GetJob (fakes en mémoire). */
import { beforeEach, describe, expect, it } from "vitest";
import { EnqueueTransformJob } from "../../../src/application/use-cases/enqueue-transform-job.js";
import { GetJob } from "../../../src/application/use-cases/get-job.js";
import { UploadImage } from "../../../src/application/use-cases/upload-image.js";
import { isErr, isOk } from "../../../src/domain/shared/result.js";
import { FakeImageProcessor } from "../../fakes/fake-image-processor.js";
import { FakeTransformJobQueue } from "../../fakes/fake-transform-job-queue.js";
import { InMemoryFileStorage } from "../../fakes/in-memory-file-storage.js";
import { InMemoryImageRepository } from "../../fakes/in-memory-image-repository.js";
import { InMemoryTransformJobRepository } from "../../fakes/in-memory-transform-job-repository.js";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("contenu")]);

describe("EnqueueTransformJob", () => {
  let images: InMemoryImageRepository;
  let jobs: InMemoryTransformJobRepository;
  let queue: FakeTransformJobQueue;
  let useCase: EnqueueTransformJob;
  let sourceId: string;

  beforeEach(async () => {
    images = new InMemoryImageRepository();
    jobs = new InMemoryTransformJobRepository();
    queue = new FakeTransformJobQueue();
    useCase = new EnqueueTransformJob(images, jobs, queue, { maxPixelsSide: 8000 });
    const uploaded = await new UploadImage(new InMemoryFileStorage(), new FakeImageProcessor(), images, { maxBytes: 1000, maxPixelsSide: 8000 }).execute({
      ownerId: "owner",
      data: JPEG,
    });
    if (!isOk(uploaded)) throw new Error("upload de test échoué");
    sourceId = uploaded.value.id;
  });

  it("crée un job `queued` en base PUIS le met en file ; la réponse n'expose ni propriétaire ni image", async () => {
    const result = await useCase.execute({ ownerId: "owner", imageId: sourceId, transformations: { rotate: 90 } });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toMatchObject({ status: "queued", sourceImageId: sourceId, attempts: 0, image: null, error: null });
    expect(jobs.jobs.get(result.value.id)?.ownerId).toBe("owner");
    expect(queue.enqueued).toEqual([result.value.id]);
    expect(JSON.stringify(result.value)).not.toContain("owner");
  });

  it("conserve les paramètres bruts dans le job (le worker les revalidera)", async () => {
    const result = await useCase.execute({ ownerId: "owner", imageId: sourceId, transformations: { rotate: 90, filter: "sepia" } });
    if (!isOk(result)) throw new Error("attendu valide");
    expect(jobs.jobs.get(result.value.id)?.props.transformations).toEqual({ rotate: 90, filter: "sepia" });
  });

  it("image d'un autre utilisateur ou inconnue : ImageNotFound, aucun job, rien en file", async () => {
    for (const [ownerId, imageId] of [["intruder", sourceId], ["owner", "inconnue"]] as const) {
      const result = await useCase.execute({ ownerId, imageId, transformations: { rotate: 90 } });
      expect(isErr(result) && result.error.kind).toBe("ImageNotFound");
    }
    expect(jobs.jobs.size).toBe(0);
    expect(queue.enqueued).toHaveLength(0);
  });

  it("paramètres invalides ou aucun paramètre : InvalidTransformation immédiat (fail fast), aucun job", async () => {
    for (const transformations of [{ rotate: 45.5 }, {}, { crop: { x: 0, y: 0, width: 9999, height: 1 } }]) {
      const result = await useCase.execute({ ownerId: "owner", imageId: sourceId, transformations });
      expect(isErr(result) && result.error.kind).toBe("InvalidTransformation");
    }
    expect(jobs.jobs.size).toBe(0);
    expect(queue.enqueued).toHaveLength(0);
  });

  it("file injoignable : QueueUnavailable ET le job est supprimé (pas de job `queued` orphelin)", async () => {
    queue.unavailable = true;
    const result = await useCase.execute({ ownerId: "owner", imageId: sourceId, transformations: { rotate: 90 } });
    expect(isErr(result) && result.error.kind).toBe("QueueUnavailable");
    expect(jobs.jobs.size).toBe(0);
  });
});

describe("GetJob", () => {
  let images: InMemoryImageRepository;
  let jobs: InMemoryTransformJobRepository;
  let enqueue: EnqueueTransformJob;
  let getJob: GetJob;
  let sourceId: string;

  beforeEach(async () => {
    images = new InMemoryImageRepository();
    jobs = new InMemoryTransformJobRepository();
    enqueue = new EnqueueTransformJob(images, jobs, new FakeTransformJobQueue(), { maxPixelsSide: 8000 });
    getJob = new GetJob(jobs, images);
    const uploaded = await new UploadImage(new InMemoryFileStorage(), new FakeImageProcessor(), images, { maxBytes: 1000, maxPixelsSide: 8000 }).execute({
      ownerId: "owner",
      data: JPEG,
    });
    if (!isOk(uploaded)) throw new Error("upload de test échoué");
    sourceId = uploaded.value.id;
  });

  async function createJob(): Promise<string> {
    const created = await enqueue.execute({ ownerId: "owner", imageId: sourceId, transformations: { rotate: 90 } });
    if (!isOk(created)) throw new Error("job de test non créé");
    return created.value.id;
  }

  it("renvoie le statut d'un job en attente (sans image ni erreur)", async () => {
    const id = await createJob();
    const result = await getJob.execute({ ownerId: "owner", jobId: id });
    expect(result).toMatchObject({ ok: true, value: { id, status: "queued", image: null, error: null } });
  });

  it("job terminé : inclut l'image dérivée ; job échoué : inclut le type et le message de l'erreur", async () => {
    const doneId = await createJob();
    const done = jobs.jobs.get(doneId)?.startProcessing();
    if (done === undefined || !isOk(done)) throw new Error("transition");
    const completed = done.value.complete(sourceId);
    if (!isOk(completed)) throw new Error("transition");
    await jobs.update(completed.value);
    const completedView = await getJob.execute({ ownerId: "owner", jobId: doneId });
    expect(completedView).toMatchObject({ ok: true, value: { status: "completed", image: { id: sourceId }, error: null } });

    const failedId = await createJob();
    const failed = jobs.jobs.get(failedId)?.fail("InvalidTransformation", "rotate invalide");
    if (failed === undefined || !isOk(failed)) throw new Error("transition");
    await jobs.update(failed.value);
    const failedView = await getJob.execute({ ownerId: "owner", jobId: failedId });
    expect(failedView).toMatchObject({ ok: true, value: { status: "failed", image: null, error: { kind: "InvalidTransformation", message: "rotate invalide" } } });
  });

  it("job d'un autre utilisateur ou inconnu : la MÊME erreur JobNotFound (jamais d'indice sur son existence)", async () => {
    const id = await createJob();
    for (const [ownerId, jobId] of [["intruder", id], ["owner", "00000000-0000-4000-8000-000000000000"]] as const) {
      const result = await getJob.execute({ ownerId, jobId });
      expect(isErr(result) && result.error.kind).toBe("JobNotFound");
    }
  });
});
