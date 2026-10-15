/** Tests d'intégration de LocalFileStorage sur un dossier temporaire. */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ImageFormat } from "../../src/domain/value-objects/image-format.js";
import { StorageKey } from "../../src/domain/value-objects/storage-key.js";
import { LocalFileStorage } from "../../src/infrastructure/storage/local-file-storage.js";

let dir: string;
let storage: LocalFileStorage;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "storage-"));
  storage = new LocalFileStorage(dir);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

describe("LocalFileStorage", () => {
  it("put crée les sous-dossiers, puis get renvoie un flux du même contenu", async () => {
    const key = StorageKey.forOriginal(ImageFormat.PNG);
    await storage.put(key, Buffer.from("contenu"));

    expect(await readFile(path.join(dir, key.value), "utf8")).toBe("contenu");
    const stream = await storage.get(key);
    expect(stream).not.toBeNull();
    expect((await readAll(stream as NodeJS.ReadableStream)).toString()).toBe("contenu");
  });

  it("exists, delete (idempotent) et get d'une clé absente", async () => {
    const key = StorageKey.forOriginal(ImageFormat.JPEG);
    expect(await storage.exists(key)).toBe(false);
    expect(await storage.get(key)).toBeNull();

    await storage.put(key, Buffer.from("x"));
    expect(await storage.exists(key)).toBe(true);

    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });

  it("refuse d'écraser un fichier existant (l'original est immuable)", async () => {
    const key = StorageKey.forOriginal(ImageFormat.WEBP);
    await storage.put(key, Buffer.from("premier"));
    await expect(storage.put(key, Buffer.from("second"))).rejects.toThrow();
    expect(await readFile(path.join(dir, key.value), "utf8")).toBe("premier");
  });
});
