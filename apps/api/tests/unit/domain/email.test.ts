/** Tests unitaires du value object Email. */
import { describe, expect, it } from "vitest";
import { isErr, isOk } from "../../../src/domain/shared/result.js";
import { Email } from "../../../src/domain/value-objects/email.js";

describe("Email.create", () => {
  it("normalise : espaces retirés et minuscules", () => {
    const result = Email.create("  Salut@Example.COM ");
    expect(isOk(result) && result.value.value).toBe("salut@example.com");
  });

  it.each(["", "sans-arobase", "a@b", "a b@c.d", "@c.d", "a@@c.d"])("refuse %j", (raw) => {
    const result = Email.create(raw);
    expect(isErr(result) && result.error.kind).toBe("InvalidEmail");
  });

  it("refuse plus de 254 caractères", () => {
    expect(isErr(Email.create(`${"a".repeat(250)}@b.cd`))).toBe(true);
  });
});
