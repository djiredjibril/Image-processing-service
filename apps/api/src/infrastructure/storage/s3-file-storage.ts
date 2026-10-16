/**
 * Implémentation `IFileStorage` sur un stockage objet compatible S3 (SeaweedFS en local, AWS S3, Garage, MinIO...).
 *
 * Couche : infrastructure (stockage). Seul endroit qui connaît le SDK S3. Contrairement au disque local, ce stockage
 * est PARTAGEABLE : l'API et plusieurs workers, même sur des machines différentes, lisent et écrivent le même bucket.
 */
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import type { IFileStorage } from "../../domain/ports/file-storage.js";
import type { StorageKey } from "../../domain/value-objects/storage-key.js";

/** Types MIME des extensions que l'application produit (les clés sont générées par le serveur). */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Statut HTTP et nom d'erreur d'une erreur du SDK, sans supposer sa forme (une erreur réseau n'a pas de statut). */
function describeError(error: unknown): { name: string; status: number | undefined } {
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } } | null | undefined;
  const name = typeof candidate?.name === "string" ? candidate.name : "";
  const status = typeof candidate?.$metadata?.httpStatusCode === "number" ? candidate.$metadata.httpStatusCode : undefined;
  return { name, status };
}

/** Vrai si l'erreur signifie « cet objet (ou ce bucket) n'existe pas ». */
function isNotFound(error: unknown): boolean {
  const { name, status } = describeError(error);
  return name === "NoSuchKey" || name === "NotFound" || name === "NoSuchBucket" || status === 404;
}

/** Vrai si l'erreur signifie « la condition `If-None-Match` n'est pas remplie » : l'objet existe déjà. */
function isAlreadyExists(error: unknown): boolean {
  const { name, status } = describeError(error);
  return name === "PreconditionFailed" || status === 412;
}

/** Stockage de fichiers dans un bucket S3. */
export class S3FileStorage implements IFileStorage {
  /**
   * Construit le stockage.
   *
   * @param client - Client S3 configuré (endpoint, région, identifiants), voir `createS3Client`.
   * @param bucket - Nom du bucket (il doit exister : voir `ensureBucket`).
   */
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  /**
   * Écrit l'objet avec `If-None-Match: *` : le serveur REFUSE (412) si la clé existe déjà. L'immuabilité des originaux
   * est donc garantie de façon ATOMIQUE par le stockage, sans « vérifier puis écrire » (qui laisserait une fenêtre de course).
   *
   * @throws Si la clé existe déjà ou en cas de panne.
   */
  async put(key: StorageKey, data: Uint8Array): Promise<void> {
    const extension = key.value.split(".").pop() ?? "";
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key.value,
          Body: data,
          ContentType: CONTENT_TYPES[extension] ?? "application/octet-stream",
          IfNoneMatch: "*",
        }),
      );
    } catch (error) {
      if (isAlreadyExists(error)) {
        throw new Error(`La clé de stockage existe déjà : ${key.value}`, { cause: error });
      }
      throw error;
    }
  }

  /** Ouvre un flux de lecture ; `null` si l'objet n'existe pas. L'appelant doit consommer ou détruire le flux. */
  async get(key: StorageKey): Promise<NodeJS.ReadableStream | null> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key.value }));
      if (!(response.Body instanceof Readable)) {
        throw new Error("Le SDK S3 n'a pas renvoyé un flux Node.js lisible");
      }
      return response.Body;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /** Supprime l'objet ; S3 répond succès même si la clé est absente (idempotent). */
  async delete(key: StorageKey): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key.value }));
  }

  /** Teste l'existence de l'objet (requête HEAD : aucune donnée transférée). */
  async exists(key: StorageKey): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key.value }));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }
}

/**
 * S'assure que le bucket existe, et le crée sinon.
 *
 * Pratique en développement. En production, les buckets sont en général créés par l'infrastructure, avec des droits
 * limités : l'application n'a alors pas le droit de créer de bucket, et cet appel échoue avec un message clair.
 *
 * @param client - Client S3.
 * @param bucket - Nom du bucket.
 * @throws Si le bucket est absent et ne peut pas être créé, ou si le serveur est injoignable.
 */
export async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}
