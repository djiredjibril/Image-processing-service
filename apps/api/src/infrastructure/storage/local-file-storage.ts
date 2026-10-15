/**
 * Implémentation `IFileStorage` sur le disque local.
 *
 * Couche : infrastructure (stockage). Seul endroit qui utilise `fs` pour les images.
 */
import { mkdir, open, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IFileStorage } from "../../domain/ports/file-storage.js";
import type { StorageKey } from "../../domain/value-objects/storage-key.js";

/** Vrai si l'erreur système porte le code donné (ex. `ENOENT`). */
function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

/** Stockage de fichiers sous un dossier racine du disque. */
export class LocalFileStorage implements IFileStorage {
  private readonly root: string;

  /**
   * Fixe la racine de stockage.
   *
   * @param rootDir - Dossier racine (relatif ou absolu) ; tous les fichiers restent dessous.
   */
  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  /** Écrit le fichier avec le drapeau `wx` : échoue si la clé existe déjà (original immuable). */
  async put(key: StorageKey, data: Uint8Array): Promise<void> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data, { flag: "wx" });
  }

  /** Ouvre un flux de lecture ; `null` si le fichier n'existe pas. */
  async get(key: StorageKey): Promise<NodeJS.ReadableStream | null> {
    try {
      const handle = await open(this.resolve(key), "r");
      return handle.createReadStream();
    } catch (error) {
      if (hasCode(error, "ENOENT")) {
        return null;
      }
      throw error;
    }
  }

  /** Supprime le fichier ; sans effet s'il n'existe pas. */
  async delete(key: StorageKey): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  /** Teste l'existence du fichier. */
  async exists(key: StorageKey): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch (error) {
      if (hasCode(error, "ENOENT")) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Transforme une clé en chemin disque et vérifie qu'il reste DANS la racine.
   * Défense en profondeur contre le « path traversal » (la clé est déjà sûre par construction).
   */
  private resolve(key: StorageKey): string {
    const target = path.resolve(this.root, key.value);
    if (!target.startsWith(this.root + path.sep)) {
      throw new Error(`Clé hors de la racine de stockage : ${key.value}`);
    }
    return target;
  }
}
