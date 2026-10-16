/** Tests du signeur d'URLs S3 : la signature est calculée localement, sans serveur S3. */
import { describe, expect, it } from "vitest";
import { ImageFormat } from "../../src/domain/value-objects/image-format.js";
import { StorageKey } from "../../src/domain/value-objects/storage-key.js";
import { createS3Client } from "../../src/infrastructure/storage/create-file-storage.js";
import { S3FileUrlSigner } from "../../src/infrastructure/storage/s3-file-url-signer.js";

const settings = { region: "us-east-1", bucket: "mon-bucket", accessKeyId: "AK", secretAccessKey: "SK", forcePathStyle: true } as const;

describe("S3FileUrlSigner", () => {
  it("produit une URL SigV4 vers l'endpoint PUBLIC, avec bucket, clé, durée et signature, mais sans secret", async () => {
    const signer = new S3FileUrlSigner(createS3Client({ ...settings, endpoint: "https://cdn.exemple.test:9000" }), "mon-bucket");
    const key = StorageKey.forOriginal(ImageFormat.PNG);
    const url = new URL(await signer.presignGet(key, 90));
    expect(url.origin).toBe("https://cdn.exemple.test:9000");
    expect(url.pathname).toBe(`/mon-bucket/${key.value}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("90");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Credential")).toContain("AK/");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.toString()).not.toContain("SK");
  });

  it("deux clés donnent deux signatures différentes ; la même clé à des durées différentes aussi", async () => {
    const signer = new S3FileUrlSigner(createS3Client({ ...settings, endpoint: "http://localhost:8333" }), "mon-bucket");
    const a = StorageKey.forOriginal(ImageFormat.PNG);
    const b = StorageKey.forOriginal(ImageFormat.PNG);
    const signature = async (key: StorageKey, ttl: number): Promise<string | null> => new URL(await signer.presignGet(key, ttl)).searchParams.get("X-Amz-Signature");
    expect(await signature(a, 60)).not.toBe(await signature(b, 60));
    expect(await signature(a, 60)).not.toBe(await signature(a, 61));
  });
});
