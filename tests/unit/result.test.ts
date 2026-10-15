/** Tests unitaires du type Result (couche application, sans I/O). */
import { describe, expect, it } from "vitest";
import { err, isErr, isOk, ok, type Result } from "../../src/application/shared/result.js";

describe("Result", () => {
  it("ok() porte la valeur et isOk() la reconnaît", () => {
    const result: Result<number, string> = ok(42);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
    if (isOk(result)) {
      expect(result.value).toBe(42);
    }
  });

  it("err() porte l'erreur et isErr() la reconnaît", () => {
    const result: Result<number, string> = err("boom");
    expect(isErr(result)).toBe(true);
    expect(isOk(result)).toBe(false);
    if (isErr(result)) {
      expect(result.error).toBe("boom");
    }
  });
});
