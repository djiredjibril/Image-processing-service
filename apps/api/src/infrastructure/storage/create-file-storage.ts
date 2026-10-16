/**
 * Fabrique du stockage de fichiers selon la configuration (`STORAGE_DRIVER`).
 *
 * Couche : infrastructure (composition). Un seul endroit choisit entre disque local et S3, partagé par l'API
 * (`main.ts`) et le worker (`worker.ts`) pour qu'ils ne puissent jamais utiliser deux stockages différents.
 */
import { S3Client } from "@aws-sdk/client-s3";
import type { IFileStorage } from "../../domain/ports/file-storage.js";
import type { IFileUrlSigner } from "../../domain/ports/file-url-signer.js";
import type { Config } from "../config/config.js";
import { LocalFileStorage } from "./local-file-storage.js";
import { S3FileUrlSigner } from "./s3-file-url-signer.js";
import { ensureBucket, S3FileStorage } from "./s3-file-storage.js";

/** Options de connexion S3 (sous-ensemble de la configuration). */
export interface S3Settings {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle: boolean;
}

/**
 * Crée un client S3.
 *
 * `forcePathStyle` : adresse `http://hôte/bucket/clé` au lieu de `http://bucket.hôte/clé`. Les stockages auto-hébergés
 * n'ont pas de DNS « un sous-domaine par bucket » : le mode « chemin » est nécessaire en local.
 *
 * @param settings - Endpoint, région, identifiants.
 * @returns Le client (les identifiants ne sont jamais journalisés).
 */
export function createS3Client(settings: S3Settings): S3Client {
  return new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: settings.forcePathStyle,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
  });
}

/** Nombre d'essais et délai entre deux essais au démarrage (le serveur S3 peut démarrer en même temps que l'application). */
const STARTUP_ATTEMPTS = 10;
const STARTUP_DELAY_MS = 1000;

/**
 * Réessaie une opération de démarrage quelques secondes avant d'abandonner.
 *
 * Pourquoi : avec `docker compose up`, l'API peut démarrer avant que la passerelle S3 accepte les connexions. Un
 * stockage réellement absent finit quand même par faire échouer le démarrage (avec la dernière erreur).
 */
async function withStartupRetries(operation: () => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await operation();
      return;
    } catch (error) {
      if (attempt >= STARTUP_ATTEMPTS) {
        throw new Error("Stockage S3 injoignable au démarrage", { cause: error });
      }
      await new Promise((resolve) => setTimeout(resolve, STARTUP_DELAY_MS));
    }
  }
}

/** Le stockage configuré, et son signeur d'URLs s'il en a un. */
export interface FileStorageBundle {
  readonly storage: IFileStorage;
  /** `null` pour le disque local (pas d'URLs présignées possibles). */
  readonly urlSigner: IFileUrlSigner | null;
}

/**
 * Construit le stockage configuré.
 *
 * @param config - Configuration validée.
 * @returns Le stockage : `LocalFileStorage` (driver `local`, sans signeur) ou `S3FileStorage` (driver `s3`, bucket créé s'il
 * n'existe pas) accompagné d'un signeur dont l'URL pointe vers `S3_PUBLIC_ENDPOINT` (sinon `S3_ENDPOINT`).
 * @throws En driver `s3`, si le serveur S3 est injoignable ou le bucket introuvable et non créable : l'application ne
 * doit pas démarrer avec un stockage inutilisable (10 essais espacés d'1 s avant d'abandonner).
 */
export async function createFileStorage(config: Config): Promise<FileStorageBundle> {
  if (config.STORAGE_DRIVER === "local") {
    return { storage: new LocalFileStorage(config.STORAGE_LOCAL_DIR), urlSigner: null };
  }
  const settings: S3Settings = {
    endpoint: config.S3_ENDPOINT ?? "",
    region: config.S3_REGION,
    bucket: config.S3_BUCKET ?? "",
    accessKeyId: config.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: config.S3_SECRET_ACCESS_KEY ?? "",
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
  };
  const client = createS3Client(settings);
  await withStartupRetries(() => ensureBucket(client, settings.bucket));
  // Client distinct pour signer : seul l'hôte de l'URL change, la signature est calculée localement (aucun appel réseau).
  const signingClient = createS3Client({ ...settings, endpoint: config.S3_PUBLIC_ENDPOINT ?? settings.endpoint });
  return { storage: new S3FileStorage(client, settings.bucket), urlSigner: new S3FileUrlSigner(signingClient, settings.bucket) };
}
