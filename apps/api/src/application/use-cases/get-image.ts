/**
 * Use case `GetImage` : ouvrir en lecture une image appartenant à l'appelant.
 *
 * Couche : application.
 */
import { ImageNotFoundError } from "../../domain/errors/image-errors.js";
import type { IFileStorage } from "../../domain/ports/file-storage.js";
import type { IImageRepository } from "../../domain/repositories/image-repository.js";
import { err, ok, type Result } from "../shared/result.js";

/** Données d'entrée. */
export interface GetImageInput {
  readonly ownerId: string;
  readonly imageId: string;
}

/** Fichier prêt à être servi : le contenu est un FLUX, jamais chargé entièrement en mémoire. */
export interface GetImageOutput {
  readonly stream: NodeJS.ReadableStream;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

/**
 * Renvoie le fichier d'une image si elle appartient à l'appelant.
 *
 * Autorisation par propriétaire : une image inconnue, ou appartenant à un autre
 * utilisateur, donne la MÊME erreur `ImageNotFoundError` (404, jamais 403).
 */
export class GetImage {
  constructor(
    private readonly images: IImageRepository,
    private readonly storage: IFileStorage,
  ) {}

  /**
   * Exécute la lecture.
   *
   * @param input - Identifiant de l'image et de l'appelant.
   * @returns `Ok({ stream, mimeType, sizeBytes })`, ou `Err(ImageNotFoundError)` si l'image
   * n'existe pas, appartient à un autre utilisateur, ou si son fichier est absent du stockage
   * (incohérence anormale, signalée dans les logs serveur).
   */
  async execute(input: GetImageInput): Promise<Result<GetImageOutput, ImageNotFoundError>> {
    const image = await this.images.findById(input.imageId);
    if (image?.ownerId !== input.ownerId) {
      return err(new ImageNotFoundError());
    }

    const stream = await this.storage.get(image.storageKey);
    if (stream === null) {
      console.error(`Incohérence : la ligne ${image.id} existe mais son fichier est absent du stockage`);
      return err(new ImageNotFoundError());
    }
    return ok({ stream, mimeType: image.format.mimeType, sizeBytes: image.size.bytes });
  }
}
