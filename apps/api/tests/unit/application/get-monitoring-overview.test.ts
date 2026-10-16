/** Tests unitaires de GetMonitoringOverview (fakes en mémoire) : agrégation, confidentialité, indisponibilité. */
import { beforeEach, describe, expect, it } from "vitest";
import { GetMonitoringOverview, RECENT_JOBS_LIMIT } from "../../../src/application/use-cases/get-monitoring-overview.js";
import { UploadImage } from "../../../src/application/use-cases/upload-image.js";
import { TransformJob } from "../../../src/domain/entities/transform-job.js";
import type { IQueueMonitor, IRedisMonitor, QueueSnapshot, RedisStats } from "../../../src/domain/ports/monitoring.js";
import { isOk } from "../../../src/domain/shared/result.js";
import { FakeImageProcessor } from "../../fakes/fake-image-processor.js";
import { InMemoryFileStorage } from "../../fakes/in-memory-file-storage.js";
import { InMemoryImageRepository } from "../../fakes/in-memory-image-repository.js";
import { InMemoryStatsCounters } from "../../fakes/in-memory-stats-counters.js";
import { InMemoryTransformJobRepository } from "../../fakes/in-memory-transform-job-repository.js";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("contenu")]);
const REDIS: RedisStats = { available: true, version: "7.4.0", usedMemoryBytes: 1000, connectedClients: 3, uptimeSeconds: 60, keys: { cacheEntries: 2, activeLocks: 0, rateLimitCounters: 5, queueKeys: 4 }, approximate: false };
const QUEUE: QueueSnapshot = { available: true, counts: { waiting: 3, active: 1, delayed: 0, completed: 10, failed: 2 }, workers: 2 };

describe("GetMonitoringOverview", () => {
  let images: InMemoryImageRepository;
  let jobs: InMemoryTransformJobRepository;
  let counters: InMemoryStatsCounters;
  let redis: IRedisMonitor;
  let queue: IQueueMonitor;
  let useCase: GetMonitoringOverview;
  let sourceId: string;

  beforeEach(async () => {
    images = new InMemoryImageRepository();
    jobs = new InMemoryTransformJobRepository();
    counters = new InMemoryStatsCounters();
    redis = { stats: () => Promise.resolve(REDIS) };
    queue = { snapshot: () => Promise.resolve(QUEUE) };
    useCase = new GetMonitoringOverview(redis, queue, counters, jobs, images);
    const uploaded = await new UploadImage(new InMemoryFileStorage(), new FakeImageProcessor(), images, { maxBytes: 1000, maxPixelsSide: 8000 }).execute({ ownerId: "alice", data: JPEG });
    if (!isOk(uploaded)) throw new Error("upload de test échoué");
    sourceId = uploaded.value.id;
  });

  const newJob = async (ownerId: string, createdAt: Date): Promise<TransformJob> => {
    const job = TransformJob.restore({ ...TransformJob.create({ ownerId, sourceImageId: sourceId, transformations: { rotate: 90 } }).props, createdAt, updatedAt: createdAt });
    await jobs.save(job);
    return job;
  };

  it("rassemble l'état de Redis, de la file, les compteurs et la date de la photographie", async () => {
    counters.values.cache_hit = 7;
    counters.values.rate_limited = 2;
    const overview = await useCase.execute("alice");
    expect(overview.redis).toEqual(REDIS);
    expect(overview.queue).toEqual(QUEUE);
    expect(overview.counters).toEqual({ cache_hit: 7, cache_miss: 0, rate_limited: 2 });
    expect(Math.abs(overview.generatedAt.getTime() - Date.now())).toBeLessThan(2000);
  });

  it("ne renvoie QUE les jobs de l'appelant (les chiffres globaux ne révèlent aucune donnée d'un autre utilisateur)", async () => {
    await newJob("alice", new Date("2026-01-01T00:00:00Z"));
    await newJob("bob", new Date("2026-01-02T00:00:00Z"));
    const overview = await useCase.execute("alice");
    expect(overview.recentJobs).toHaveLength(1);
    expect(JSON.stringify(overview)).not.toContain("bob");
  });

  it(`limite à ${String(RECENT_JOBS_LIMIT)} jobs, du plus récent au plus ancien`, async () => {
    for (let i = 0; i < RECENT_JOBS_LIMIT + 5; i++) await newJob("alice", new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
    const overview = await useCase.execute("alice");
    expect(overview.recentJobs).toHaveLength(RECENT_JOBS_LIMIT);
    const times = overview.recentJobs.map((job) => job.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(times[0]).toBe(Date.UTC(2026, 0, 1, 0, 0, RECENT_JOBS_LIMIT + 4));
  });

  it("joint l'image dérivée d'un job terminé, et aucune image pour un job en attente ou échoué", async () => {
    const waiting = await newJob("alice", new Date("2026-01-01T00:00:00Z"));
    const done = await newJob("alice", new Date("2026-01-02T00:00:00Z"));
    const failed = await newJob("alice", new Date("2026-01-03T00:00:00Z"));
    const started = done.startProcessing();
    if (!isOk(started)) throw new Error("transition");
    const completed = started.value.complete(sourceId);
    if (!isOk(completed)) throw new Error("transition");
    await jobs.update(completed.value);
    const failedNext = failed.fail("InvalidTransformation", "x");
    if (!isOk(failedNext)) throw new Error("transition");
    await jobs.update(failedNext.value);

    const overview = await useCase.execute("alice");
    const byId = new Map(overview.recentJobs.map((job) => [job.id, job]));
    expect(byId.get(done.id)?.image?.id).toBe(sourceId);
    expect(byId.get(waiting.id)?.image).toBeNull();
    expect(byId.get(failed.id)).toMatchObject({ image: null, error: { kind: "InvalidTransformation" } });
  });

  it("Redis ou la file indisponibles ne sont pas des erreurs : leur état est simplement transmis", async () => {
    redis = { stats: () => Promise.resolve({ ...REDIS, available: false, keys: null }) };
    queue = { snapshot: () => Promise.resolve({ ...QUEUE, available: false }) };
    const overview = await new GetMonitoringOverview(redis, queue, counters, jobs, images).execute("alice");
    expect(overview.redis.available).toBe(false);
    expect(overview.queue.available).toBe(false);
  });

  it("aucun job : liste vide", async () => {
    expect((await useCase.execute("alice")).recentJobs).toEqual([]);
  });
});
