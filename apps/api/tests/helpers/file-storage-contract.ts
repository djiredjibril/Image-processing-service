/** Contrat de comportement d'un `IFileStorage`, exécuté contre le disque local ET contre S3. */
import { describe, expect, it } from "vitest";
import type { IFileStorage } from "../../src/domain/ports/file-storage.js";
import { ImageFormat } from "../../src/domain/value-objects/image-format.js";
import { StorageKey } from "../../src/domain/value-objects/storage-key.js";

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/**
 * Déclare les tests de contrat.
 *
 * @param name - Nom de l'implémentation testée.
 * @param create - Fournit un stockage VIDE (les clés sont aléatoires, donc sans collision entre tests).
 */
export function describeFileStorageContract(name: string, create: () => IFileStorage): void {
  describe(`contrat IFileStorage : ${name}`, () => {
    const original = (): StorageKey => StorageKey.forOriginal(ImageFormat.PNG);

    it("put puis get restitue exactement les mêmes octets (dont des octets non textuels)", async () => {
      const storage = create();
      const key = original();
      const data = Uint8Array.from([0, 1, 2, 255, 254, 0, 128, 137, 80, 78, 71]);
      await storage.put(key, data);
      const stream = await storage.get(key);
      expect(stream).not.toBeNull();
      expect(stream === null ? null : (await readAll(stream)).equals(Buffer.from(data))).toBe(true);
    });

    it("gère un fichier de plusieurs Mo, lu en flux", async () => {
      const storage = create();
      const key = StorageKey.forDerived(ImageFormat.WEBP);
      const data = Buffer.alloc(6 * 1024 * 1024);
      for (let i = 0; i < data.length; i += 4096) data[i] = i % 251;
      await storage.put(key, data);
      const stream = await storage.get(key);
      expect(stream === null ? null : (await readAll(stream)).equals(data)).toBe(true);
    });

    it("get d'une clé absente renvoie null (sans lever d'erreur)", async () => {
      expect(await create().get(original())).toBeNull();
    });

    it("exists est faux avant put, vrai après, faux après delete", async () => {
      const storage = create();
      const key = original();
      expect(await storage.exists(key)).toBe(false);
      await storage.put(key, Uint8Array.from([1]));
      expect(await storage.exists(key)).toBe(true);
      await storage.delete(key);
      expect(await storage.exists(key)).toBe(false);
      expect(await storage.get(key)).toBeNull();
    });

    it("delete d'une clé absente est sans erreur (idempotent), même répété", async () => {
      const storage = create();
      const key = original();
      await expect(storage.delete(key)).resolves.toBeUndefined();
      await expect(storage.delete(key)).resolves.toBeUndefined();
    });

    it("IMMUABLE : un second put sur la même clé échoue et le contenu d'origine est conservé", async () => {
      const storage = create();
      const key = original();
      await storage.put(key, Uint8Array.from([1, 1, 1]));
      await expect(storage.put(key, Uint8Array.from([9, 9, 9]))).rejects.toThrow();
      const stream = await storage.get(key);
      expect(stream === null ? null : [...(await readAll(stream))]).toEqual([1, 1, 1]);
    });

    it("ATOMIQUE : 5 put simultanés sur la même clé, un seul réussit", async () => {
      const storage = create();
      const key = original();
      const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => storage.put(key, Uint8Array.from([i + 1]))));
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    });

    it("des clés différentes sont indépendantes", async () => {
      const storage = create();
      const a = original();
      const b = original();
      await storage.put(a, Uint8Array.from([1]));
      expect(await storage.exists(b)).toBe(false);
      await storage.delete(b);
      expect(await storage.exists(a)).toBe(true);
    });
  });
}
