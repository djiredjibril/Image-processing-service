/**
 * Signeur d'URLs présignées pour un bucket S3.
 *
 * Couche : infrastructure (stockage). Implémente `IFileUrlSigner`.
 */
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { IFileUrlSigner } from "../../domain/ports/file-url-signer.js";
import type { StorageKey } from "../../domain/value-objects/storage-key.js";

/** Fabrique d'URLs présignées (signature SigV4 calculée localement, sans appel réseau). */
export class S3FileUrlSigner implements IFileUrlSigner {
  /**
   * Construit le signeur.
   *
   * @param client - Client S3 configuré avec l'endpoint **public** (celui que le navigateur peut atteindre) : l'hôte de
   * l'URL signée est celui du client, et il fait partie de la signature (on ne peut pas le remplacer après coup).
   * @param bucket - Nom du bucket.
   */
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  /** Signe localement une requête `GET` : aucun appel réseau, donc aucune panne possible du serveur S3 à cette étape. */
  presignGet(key: StorageKey, ttlSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key.value }), { expiresIn: ttlSeconds });
  }
}
