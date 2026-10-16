/**
 * Use case `GetImageUrl` : obtenir une URL temporaire pour télécharger une image directement depuis le stockage.
 *
 * Couche : application.
 */
import { ImageNotFoundError } from "../../domain/errors/image-errors.js";
import type { IFileStorage } from "../../domain/ports/file-storage.js";
import type { IFileUrlSigner } from "../../domain/ports/file-url-signer.js";
import type { IImageRepository } from "../../domain/repositories/image-repository.js";
import { err, ok, type Result } from "../shared/result.js";

/** Données d'entrée. */
export interface GetImageUrlInput {
  readonly ownerId: string;
  readonly imageId: string;
}

/** URL temporaire et sa durée de validité. */
export interface GetImageUrlOutput {
  /** URL signée, utilisable SANS jeton jusqu'à `expiresAt`. */
  readonly url: string;
  readonly expiresInSeconds: number;
  readonly expiresAt: Date;
}

/** Le stockage configuré ne sait pas fabriquer d'URL signée (ex. disque local). */
export class PresignedUrlsUnsupportedError {
  readonly kind = "PresignedUrlsUnsupported" as const;
}

/** Erreurs métier possibles de `GetImageUrl`. */
export type GetImageUrlError = ImageNotFoundError | PresignedUrlsUnsupportedError;

/**
 * Délivre une URL signée de courte durée pour une image de l'appelant.
 *
 * Pourquoi : servir une image par `GET /images/:id` fait transiter chaque octet par l'API. Avec une URL signée, l'API ne fait
 * que l'AUTORISATION (« cet utilisateur a-t-il le droit ? ») et le navigateur télécharge ensuite directement depuis le
 * stockage, ce qui décharge l'API de la bande passante.
 *
 * Sécurité : l'autorisation par propriétaire est vérifiée AVANT de signer (image d'un autre utilisateur : 404, jamais 403) ;
 * l'URL expire vite ; elle porte la permission, quiconque la possède peut lire le fichier tant qu'elle est valable.
 */
export class GetImageUrl {
  /**
   * Construit le use case.
   *
   * @param images - Métadonnées des images.
   * @param storage - Stockage (vérifie que le fichier existe avant de signer).
   * @param signer - Signeur d'URLs, ou `null` si le stockage n'en propose pas.
   * @param ttlSeconds - Durée de validité des URLs délivrées.
   */
  constructor(
    private readonly images: IImageRepository,
    private readonly storage: IFileStorage,
    private readonly signer: IFileUrlSigner | null,
    private readonly ttlSeconds: number,
  ) {}

  /**
   * Exécute la demande.
   *
   * @param input - Identifiants de l'image et de l'appelant.
   * @returns `Ok({ url, expiresInSeconds, expiresAt })`, ou `Err` parmi : `ImageNotFoundError` (inconnue, d'un autre
   * utilisateur, ou fichier absent du stockage), `PresignedUrlsUnsupportedError` (stockage sans URLs signées).
   * @throws Si la base ou le stockage tombent en panne.
   */
  async execute(input: GetImageUrlInput): Promise<Result<GetImageUrlOutput, GetImageUrlError>> {
    // L'autorisation passe en premier : même sans URLs signées, une image d'autrui reste « introuvable ».
    const image = await this.images.findById(input.imageId);
    if (image?.ownerId !== input.ownerId) {
      return err(new ImageNotFoundError());
    }
    if (this.signer === null) {
      return err(new PresignedUrlsUnsupportedError());
    }
    if (!(await this.storage.exists(image.storageKey))) {
      console.error(`Incohérence : la ligne ${image.id} existe mais son fichier est absent du stockage`);
      return err(new ImageNotFoundError());
    }
    const url = await this.signer.presignGet(image.storageKey, this.ttlSeconds);
    return ok({ url, expiresInSeconds: this.ttlSeconds, expiresAt: new Date(Date.now() + this.ttlSeconds * 1000) });
  }
}
