/** Aides de test : client S3 vers le SeaweedFS de docker-compose, avec un bucket de TEST (jamais celui de dev). */
import "dotenv/config";
import { DeleteObjectsCommand, ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import { createS3Client } from "../../src/infrastructure/storage/create-file-storage.js";
import { ensureBucket, S3FileStorage } from "../../src/infrastructure/storage/s3-file-storage.js";

/** Bucket réservé aux tests : vidé avant et après. Refusé s'il ressemble à un bucket de développement. */
export function testS3Bucket(): string {
  const bucket = process.env["TEST_S3_BUCKET"] ?? "imageservice-test";
  if (!bucket.includes("test")) {
    throw new Error(`TEST_S3_BUCKET doit contenir « test » pour ne jamais vider un bucket de développement (reçu : ${bucket})`);
  }
  return bucket;
}

/** Client S3 des tests (par défaut le SeaweedFS local et ses identifiants de développement). */
export function createTestS3Client(): S3Client {
  return createS3Client({
    endpoint: process.env["TEST_S3_ENDPOINT"] ?? "http://localhost:8333",
    region: "us-east-1",
    bucket: testS3Bucket(),
    accessKeyId: process.env["TEST_S3_ACCESS_KEY_ID"] ?? "imageservice",
    secretAccessKey: process.env["TEST_S3_SECRET_ACCESS_KEY"] ?? "imageservice-secret",
    forcePathStyle: true,
  });
}

/**
 * Prépare le bucket de test et renvoie un stockage S3 dessus.
 *
 * @throws Avec un message clair si SeaweedFS n'est pas lancé.
 */
export async function createTestS3Storage(): Promise<{ client: S3Client; storage: S3FileStorage; bucket: string }> {
  const client = createTestS3Client();
  const bucket = testS3Bucket();
  try {
    await ensureBucket(client, bucket);
  } catch (error) {
    throw new Error("SeaweedFS de test injoignable : lancer `docker compose up -d --wait` (port 8333)", { cause: error });
  }
  await emptyTestBucket(client);
  return { client, storage: new S3FileStorage(client, bucket), bucket };
}

/** Supprime tous les objets du bucket de test (par lots de 1000). */
export async function emptyTestBucket(client: S3Client): Promise<void> {
  const bucket = testS3Bucket();
  for (;;) {
    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
    const keys = (listed.Contents ?? []).flatMap((object) => (object.Key === undefined ? [] : [{ Key: object.Key }]));
    if (keys.length === 0) return;
    await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
  }
}
