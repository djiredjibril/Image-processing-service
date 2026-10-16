/** Le même contrat IFileStorage est vérifié pour le disque local et pour un vrai stockage S3 (SeaweedFS). */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll } from "vitest";
import { LocalFileStorage } from "../../src/infrastructure/storage/local-file-storage.js";
import { S3FileStorage } from "../../src/infrastructure/storage/s3-file-storage.js";
import { describeFileStorageContract } from "../helpers/file-storage-contract.js";
import { createTestS3Storage, emptyTestBucket } from "../helpers/test-s3.js";
import type { S3Client } from "@aws-sdk/client-s3";

let dir: string;
let s3: S3FileStorage;
let s3Client: S3Client;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "storage-contract-"));
  const prepared = await createTestS3Storage();
  s3 = prepared.storage;
  s3Client = prepared.client;
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await emptyTestBucket(s3Client);
});

describeFileStorageContract("LocalFileStorage", () => new LocalFileStorage(dir));
describeFileStorageContract("S3FileStorage (SeaweedFS)", () => s3);
