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

  /** Si renseignée, `transform` attend cette promesse avant de répondre : permet de simuler un traitement lent. */
  transformGate: Promise<void> | null = null;
  private onTransformStarted: (() => void) | null = null;

  /** Promesse résolue au prochain appel de `transform` : permet de savoir qu'un traitement a démarré. */
  nextTransformStarted(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.onTransformStarted = resolve;
    });
  }

  async transform(data: Uint8Array, transformations: TransformationSet, outputFormat: ImageFormat): Promise<Result<TransformedImage, CorruptedImageError>> {
    this.transformCalls.push({ data, transformations, outputFormat });
    // Le résultat est celui configuré au DÉMARRAGE de ce traitement, pas à sa fin (comme un vrai traitement).
    const outcome = this.transformed;
    this.onTransformStarted?.();
    if (this.transformGate !== null) {
      await this.transformGate;
    }
    if (outcome === null) {
      return err(new CorruptedImageError("illisible"));
    }
    return ok({ data: outcome.bytes, format: outputFormat, width: outcome.width, height: outcome.height });
  }
}
