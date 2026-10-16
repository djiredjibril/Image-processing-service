/**
 * Value Object représentant une clé de stockage de fichier.
 *
 * Couche : domaine.
 */
import { randomUUID } from "node:crypto";
import type { ImageFormat } from "./image-format.js";

// Segments en minuscules/chiffres/_/- séparés par `/`, puis une extension.
// Interdit par construction : `..`, `/` initial, `\`, caractères spéciaux.
const SAFE_KEY = /^(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.[a-z0-9]+$/;

/**
 * Clé identifiant un fichier dans un `IFileStorage` (ex. `originals/<uuid>.jpg`).
 *
 * Invariants : c'est une chaîne relative et « sûre » (jamais un chemin absolu, jamais de
 * `..`). Elle est GÉNÉRÉE par le serveur : le nom de fichier fourni par l'utilisateur
 * n'est jamais utilisé pour stocker.
 */
export class StorageKey {
  private constructor(public readonly value: string) {}

  /**
   * Génère la clé d'un nouvel original.
   *
   * @param format - Format réel de l'image (détermine l'extension).
   * @returns Une clé unique de la forme `originals/<uuid>.<ext>`.
   */
  static forOriginal(format: ImageFormat): StorageKey {
    return new StorageKey(`originals/${randomUUID()}.${format.extension}`);
  }

  /**
   * Génère la clé d'une image dérivée (résultat d'une transformation).
   *
   * @param format - Format réel du fichier produit (détermine l'extension).
   * @returns Une clé unique de la forme `derived/<uuid>.<ext>`.
   */
  static forDerived(format: ImageFormat): StorageKey {
    return new StorageKey(`derived/${randomUUID()}.${format.extension}`);
  }

  /**
   * Reconstruit une clé existante (ex. lue en base).
   *
   * @param value - Clé telle que stockée.
   * @returns La clé.
   * @throws Si la forme n'est pas sûre : donnée corrompue ou bug, pas une erreur métier.
   */
  static restore(value: string): StorageKey {
    if (!SAFE_KEY.test(value)) {
      throw new Error(`Clé de stockage invalide : ${value}`);
    }
    return new StorageKey(value);
  }
}
