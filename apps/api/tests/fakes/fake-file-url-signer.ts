/** Fake de `IFileUrlSigner` : fabrique une URL lisible qui permet de vérifier la clé et la durée demandées. */
import type { IFileUrlSigner } from "../../src/domain/ports/file-url-signer.js";
import type { StorageKey } from "../../src/domain/value-objects/storage-key.js";

/** Signeur factice (aucune vraie signature). */
export class FakeFileUrlSigner implements IFileUrlSigner {
  readonly calls: { key: string; ttlSeconds: number }[] = [];

  presignGet(key: StorageKey, ttlSeconds: number): Promise<string> {
    this.calls.push({ key: key.value, ttlSeconds });
    return Promise.resolve(`https://storage.example/${key.value}?ttl=${String(ttlSeconds)}`);
  }
}
