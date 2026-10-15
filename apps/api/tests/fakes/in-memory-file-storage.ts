/** Fake en mémoire de `IFileStorage` pour les tests unitaires. */
import { Readable } from "node:stream";
import type { IFileStorage } from "../../src/domain/ports/file-storage.js";
import type { StorageKey } from "../../src/domain/value-objects/storage-key.js";

/** Stockage en mémoire ; `files` permet d'inspecter ce qui a été écrit. */
export class InMemoryFileStorage implements IFileStorage {
  readonly files = new Map<string, Uint8Array>();

  put(key: StorageKey, data: Uint8Array): Promise<void> {
    if (this.files.has(key.value)) {
      return Promise.reject(new Error("clé déjà utilisée"));
    }
    this.files.set(key.value, data);
    return Promise.resolve();
  }

  get(key: StorageKey): Promise<NodeJS.ReadableStream | null> {
    const data = this.files.get(key.value);
    return Promise.resolve(data === undefined ? null : Readable.from(data));
  }

  delete(key: StorageKey): Promise<void> {
    this.files.delete(key.value);
    return Promise.resolve();
  }

  exists(key: StorageKey): Promise<boolean> {
    return Promise.resolve(this.files.has(key.value));
  }
}
