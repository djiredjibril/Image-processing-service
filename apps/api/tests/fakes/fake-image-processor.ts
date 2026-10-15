/** Fake de `IImageProcessor` : renvoie des métadonnées configurées et compte les appels. */
import { CorruptedImageError } from "../../src/domain/errors/image-errors.js";
import type { IImageProcessor, ImageMetadata, TransformedImage } from "../../src/domain/ports/image-processor.js";
import { err, ok, type Result } from "../../src/domain/shared/result.js";
import type { ImageFormat } from "../../src/domain/value-objects/image-format.js";
import type { TransformationSet } from "../../src/domain/value-objects/transformation-set.js";

/** Appel enregistré de `transform`. */
export interface TransformCall {
  readonly data: Uint8Array;
  readonly transformations: TransformationSet;
  readonly outputFormat: ImageFormat;
}

/** Processeur factice. `metadata = null` simule une image illisible. */
export class FakeImageProcessor implements IImageProcessor {
  calls = 0;
  readonly transformCalls: TransformCall[] = [];
  /** Résultat renvoyé par `transform` ; `null` simule une source illisible. */
  transformed: { width: number; height: number; bytes: Uint8Array } | null = { width: 50, height: 25, bytes: Uint8Array.from([9, 9, 9]) };

  constructor(public metadata: ImageMetadata | null = { format: "jpeg", width: 100, height: 50 }) {}

  readMetadata(): Promise<Result<ImageMetadata, CorruptedImageError>> {
    this.calls += 1;
    return Promise.resolve(this.metadata === null ? err(new CorruptedImageError("illisible")) : ok(this.metadata));
  }

  transform(data: Uint8Array, transformations: TransformationSet, outputFormat: ImageFormat): Promise<Result<TransformedImage, CorruptedImageError>> {
    this.transformCalls.push({ data, transformations, outputFormat });
    if (this.transformed === null) {
      return Promise.resolve(err(new CorruptedImageError("illisible")));
    }
    return Promise.resolve(ok({ data: this.transformed.bytes, format: outputFormat, width: this.transformed.width, height: this.transformed.height }));
  }
}
