/**
 * Écriture d'une image : fichier puis ligne en base, avec compensation.
 *
 * Couche : application (partagé), utilisé par les use cases qui créent une image (upload, transformation).
 */
import type { Image } from "../../domain/entities/image.js";
import type { IFileStorage } from "../../domain/ports/file-storage.js";
import type { IImageRepository } from "../../domain/repositories/image-repository.js";

/**
 * Écrit le fichier AVANT la ligne en base, et défait le fichier si la base échoue.
 *
 * Compensation : fichier et base n'ont pas de transaction commune. Si l'insertion échoue, on
 * supprime le fichier pour ne pas laisser d'orphelin, puis on relance l'erreur d'origine. Le
 * nettoyage est « au mieux » : son échec ne masque pas l'erreur d'origine.
 *
 * @param storage - Stockage de fichiers.
 * @param images - Repository des images.
 * @param image - Entité à enregistrer (sa clé de stockage désigne l'emplacement du fichier).
 * @param data - Contenu du fichier.
 * @throws Si le stockage ou la base tombent en panne (erreur inattendue).
 */
export async function storeImage(storage: IFileStorage, images: IImageRepository, image: Image, data: Uint8Array): Promise<void> {
  await storage.put(image.storageKey, data);
  try {
    await images.save(image);
  } catch (error) {
    try {
      await storage.delete(image.storageKey);
    } catch (cleanupError) {
      console.error(`Compensation impossible : fichier orphelin ${image.storageKey.value}`, cleanupError);
    }
    throw error;
  }
}
