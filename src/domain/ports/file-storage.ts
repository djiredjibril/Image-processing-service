/**
 * Port `IFileStorage` : stockage de fichiers par clé.
 *
 * Couche : domaine (port). Implémentation actuelle : `LocalFileStorage` (disque) ; un
 * stockage objet S3 viendra en phase 5. Aucun use case ni route n'utilise `fs` directement.
 */
import type { StorageKey } from "../value-objects/storage-key.js";

/**
 * Contrat de stockage de fichiers.
 *
 * Toute implémentation traite les clés comme des identifiants opaques (jamais des chemins
 * fournis par l'utilisateur) et ne peut lire ni écrire en dehors de sa racine de stockage.
 */
export interface IFileStorage {
  /**
   * Écrit un fichier sous la clé donnée.
   *
   * @param key - Clé de destination.
   * @param data - Contenu à écrire.
   * @throws Si la clé existe déjà (un original est immuable : jamais d'écrasement) ou en cas de panne.
   */
  put(key: StorageKey, data: Uint8Array): Promise<void>;

  /**
   * Ouvre un fichier en lecture, en flux (sans le charger entièrement en mémoire).
   *
   * @param key - Clé du fichier.
   * @returns Le flux de lecture, ou `null` si la clé n'existe pas. Ne lève pas d'erreur pour « introuvable ».
   */
  get(key: StorageKey): Promise<NodeJS.ReadableStream | null>;

  /**
   * Supprime un fichier.
   *
   * @param key - Clé du fichier.
   * @returns Rien ; supprimer une clé absente n'est pas une erreur (idempotent).
   */
  delete(key: StorageKey): Promise<void>;

  /**
   * Teste l'existence d'un fichier.
   *
   * @param key - Clé du fichier.
   * @returns `true` si le fichier existe.
   */
  exists(key: StorageKey): Promise<boolean>;
}
