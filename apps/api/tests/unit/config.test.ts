/** Tests unitaires de la validation de configuration (zod). */
import { describe, expect, it } from "vitest";
import { isErr, isOk } from "../../src/application/shared/result.js";
import { loadConfig } from "../../src/infrastructure/config/config.js";

const validEnv = {
  DATABASE_URL: "postgres://u:p@localhost:5432/dev",
  TEST_DATABASE_URL: "postgres://u:p@localhost:5432/test",
  JWT_SECRET: "x".repeat(32),
};

describe("loadConfig", () => {
  it("accepte une config minimale et applique les valeurs par défaut", () => {
    const result = loadConfig(validEnv);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.PORT).toBe(3000);
      expect(result.value.MAX_UPLOAD_BYTES).toBe(10_485_760);
      expect(result.value.MAX_IMAGE_PIXELS_SIDE).toBe(8000);
      expect(result.value.STORAGE_DRIVER).toBe("local");
    }
  });

  it("convertit les nombres fournis en chaînes", () => {
    const result = loadConfig({ ...validEnv, PORT: "8080", MAX_UPLOAD_BYTES: "1024" });
    expect(isOk(result) && result.value.PORT === 8080 && result.value.MAX_UPLOAD_BYTES === 1024).toBe(true);
  });

  it("refuse une config sans DATABASE_URL", () => {
    const { DATABASE_URL: _omitted, ...rest } = validEnv;
    const result = loadConfig(rest);
    expect(isErr(result) && result.error.some((line) => line.startsWith("DATABASE_URL"))).toBe(true);
  });

  it("refuse un JWT_SECRET trop court", () => {
    const result = loadConfig({ ...validEnv, JWT_SECRET: "court" });
    expect(isErr(result) && result.error.some((line) => line.startsWith("JWT_SECRET"))).toBe(true);
  });

  it("valide le format de JWT_EXPIRES_IN", () => {
    expect(isOk(loadConfig({ ...validEnv, JWT_EXPIRES_IN: "15m" }))).toBe(true);
    expect(isErr(loadConfig({ ...validEnv, JWT_EXPIRES_IN: "bientôt" }))).toBe(true);
  });

  it("CORS_ORIGIN : défaut Angular, origine exacte acceptée, jokers et chemins refusés", () => {
    const withDefault = loadConfig(validEnv);
    expect(isOk(withDefault) && withDefault.value.CORS_ORIGIN).toBe("http://localhost:4200");
    expect(isOk(loadConfig({ ...validEnv, CORS_ORIGIN: "https://app.example.com" }))).toBe(true);
    for (const bad of ["*", "localhost:4200", "http://localhost:4200/", "http://localhost:4200/app", ""]) {
      expect(isErr(loadConfig({ ...validEnv, CORS_ORIGIN: bad }))).toBe(true);
    }
  });

  it("refuse un STORAGE_DRIVER inconnu et un PORT hors bornes", () => {
    expect(isErr(loadConfig({ ...validEnv, STORAGE_DRIVER: "gcs" }))).toBe(true);
    expect(isErr(loadConfig({ ...validEnv, PORT: "70000" }))).toBe(true);
  });

  describe("stockage S3", () => {
    const s3Env = {
      ...validEnv,
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "http://localhost:8333",
      S3_BUCKET: "imageservice-dev",
      S3_ACCESS_KEY_ID: "id",
      S3_SECRET_ACCESS_KEY: "secret",
    };

    it("accepte une configuration S3 complète, avec région us-east-1 et adressage par chemin par défaut", () => {
      const result = loadConfig(s3Env);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toMatchObject({ STORAGE_DRIVER: "s3", S3_REGION: "us-east-1", S3_FORCE_PATH_STYLE: true });
      }
    });

    it("exige chacune des variables S3 quand STORAGE_DRIVER=s3, en nommant celle qui manque", () => {
      for (const name of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
        const { [name]: _removed, ...incomplete } = s3Env as Record<string, string>;
        const result = loadConfig(incomplete);
        expect(isErr(result) && result.error.some((line) => line.includes(name))).toBe(true);
      }
    });

    it("n'exige aucune variable S3 avec le driver local, et refuse un endpoint ou un nom de bucket invalide", () => {
      expect(isOk(loadConfig(validEnv))).toBe(true);
      expect(isErr(loadConfig({ ...s3Env, S3_ENDPOINT: "pas-une-url" }))).toBe(true);
      expect(isErr(loadConfig({ ...s3Env, S3_BUCKET: "ab" }))).toBe(true);
      expect(isErr(loadConfig({ ...s3Env, S3_FORCE_PATH_STYLE: "peut-etre" }))).toBe(true);
    });

    it("URLs présignées : durée de 300 s par défaut, bornée de 1 s à 7 jours ; endpoint public optionnel et valide", () => {
      const defaults = loadConfig(s3Env);
      expect(isOk(defaults) && defaults.value.PRESIGNED_URL_TTL_SECONDS).toBe(300);
      expect(isOk(defaults) && defaults.value.S3_PUBLIC_ENDPOINT).toBeUndefined();
      expect(isOk(loadConfig({ ...s3Env, PRESIGNED_URL_TTL_SECONDS: "604800", S3_PUBLIC_ENDPOINT: "https://cdn.exemple.test" }))).toBe(true);
      for (const bad of ["0", "604801", "-5", "abc", "1.5"]) {
        expect(isErr(loadConfig({ ...s3Env, PRESIGNED_URL_TTL_SECONDS: bad }))).toBe(true);
      }
      expect(isErr(loadConfig({ ...s3Env, S3_PUBLIC_ENDPOINT: "pas-une-url" }))).toBe(true);
    });
  });

  describe("durcissement (phase 6)", () => {
    it("valeurs par défaut sûres : aucun proxy de confiance, 2 transformations simultanées, 10 connexions par e-mail et par 15 min", () => {
      const result = loadConfig(validEnv);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toMatchObject({
          TRUST_PROXY: 0,
          MAX_CONCURRENT_TRANSFORMS: 2,
          RATE_LIMIT_LOGIN_EMAIL: 10,
          RATE_LIMIT_LOGIN_EMAIL_WINDOW_SECONDS: 900,
        });
      }
    });

    it("TRUST_PROXY est un petit entier (0 à 10) : « true », négatif ou décimal sont refusés", () => {
      expect(isOk(loadConfig({ ...validEnv, TRUST_PROXY: "1" }))).toBe(true);
      for (const bad of ["true", "-1", "1.5", "11"]) {
        expect(isErr(loadConfig({ ...validEnv, TRUST_PROXY: bad }))).toBe(true);
      }
    });

    it("MAX_CONCURRENT_TRANSFORMS est borné (1 à 64) et les limites de connexion par e-mail doivent être positives", () => {
      for (const bad of ["0", "65", "abc"]) expect(isErr(loadConfig({ ...validEnv, MAX_CONCURRENT_TRANSFORMS: bad }))).toBe(true);
      for (const bad of ["0", "-3"]) {
        expect(isErr(loadConfig({ ...validEnv, RATE_LIMIT_LOGIN_EMAIL: bad }))).toBe(true);
        expect(isErr(loadConfig({ ...validEnv, RATE_LIMIT_LOGIN_EMAIL_WINDOW_SECONDS: bad }))).toBe(true);
      }
    });
  });
});
