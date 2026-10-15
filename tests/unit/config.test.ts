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

  it("refuse un STORAGE_DRIVER inconnu et un PORT hors bornes", () => {
    expect(isErr(loadConfig({ ...validEnv, STORAGE_DRIVER: "s3" }))).toBe(true);
    expect(isErr(loadConfig({ ...validEnv, PORT: "70000" }))).toBe(true);
  });
});
