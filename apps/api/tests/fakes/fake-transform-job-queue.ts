/** Fake de `ITransformJobQueue` : enregistre les jobs mis en file ; peut simuler une file injoignable. */
import { QueueUnavailableError } from "../../src/domain/errors/job-errors.js";
import type { ITransformJobQueue } from "../../src/domain/ports/transform-job-queue.js";
import { err, ok, type Result } from "../../src/domain/shared/result.js";

/** File factice. Mettre `unavailable` pour simuler Redis injoignable. */
export class FakeTransformJobQueue implements ITransformJobQueue {
  readonly enqueued: string[] = [];
  unavailable = false;

  enqueue(jobId: string): Promise<Result<void, QueueUnavailableError>> {
    if (this.unavailable) {
      return Promise.resolve(err(new QueueUnavailableError()));
    }
    this.enqueued.push(jobId);
    return Promise.resolve(ok(undefined));
  }
}
