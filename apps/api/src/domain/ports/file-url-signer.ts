/**
 * Port `IFileUrlSigner` : fabrication d'URLs de lecture temporaires et signées.
 *
 * Couche : domaine (port). Implémentation : `S3FileUrlSigner`. Le stockage sur disque n'en a pas : il n'a pas d'adresse
 * réseau propre, c'est l'API qui sert ses fichiers.
 */
import type { StorageKey } from "../value-objects/storage-key.js";

/**
 * Contrat d'un signeur d'URLs.
 *
 * Une URL signée est une PERMISSION portée par l'URL elle-même : quiconque la possède peut lire le fichier, sans jeton
 * d'authentification, jusqu'à son expiration. Elle ne doit donc être délivrée qu'à un appelant déjà autorisé, valable peu
 * de temps, et jamais journalisée.
 */
export interface IFileUrlSigner {
  /**
   * Fabrique une URL de lecture (GET) temporaire pour un fichier.
   *
   * @param key - Clé du fichier (le fichier n'est pas vérifié : c'est à l'appelant de s'assurer qu'il existe).
   * @param ttlSeconds - Durée de validité en secondes (entier >= 1).
   * @returns L'URL complète, utilisable sans authentification jusqu'à son expiration.
   */
  presignGet(key: StorageKey, ttlSeconds: number): Promise<string>;
}
