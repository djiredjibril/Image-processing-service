/** Fake en mémoire de `ITransformJobRepository`. */
import type { TransformJob } from "../../src/domain/entities/transform-job.js";
import type { ITransformJobRepository } from "../../src/domain/repositories/transform-job-repository.js";

/** Repository de jobs en mémoire. */
export class InMemoryTransformJobRepository implements ITransformJobRepository {
  readonly jobs = new Map<string, TransformJob>();

  save(job: TransformJob): Promise<void> {
    this.jobs.set(job.id, job);
    return Promise.resolve();
  }

  update(job: TransformJob): Promise<void> {
    this.jobs.set(job.id, job);
    return Promise.resolve();
  }

  findById(id: string): Promise<TransformJob | null> {
    return Promise.resolve(this.jobs.get(id) ?? null);
  }

  delete(id: string): Promise<void> {
    this.jobs.delete(id);
    return Promise.resolve();
  }
}
