/** Fake de `IImageProcessor` : renvoie des métadonnées configurées et compte les appels. */
import { CorruptedImageError } from "../../src/domain/errors/image-errors.js";
import type { IImageProcessor, ImageMetadata } from "../../src/domain/ports/image-processor.js";
import { err, ok, type Result } from "../../src/domain/shared/result.js";

/** Processeur factice. `metadata = null` simule une image illisible. */
export class FakeImageProcessor implements IImageProcessor {
  calls = 0;

  constructor(public metadata: ImageMetadata | null = { format: "jpeg", width: 100, height: 50 }) {}

  readMetadata(): Promise<Result<ImageMetadata, CorruptedImageError>> {
    this.calls += 1;
    return Promise.resolve(this.metadata === null ? err(new CorruptedImageError("illisible")) : ok(this.metadata));
  }
}
