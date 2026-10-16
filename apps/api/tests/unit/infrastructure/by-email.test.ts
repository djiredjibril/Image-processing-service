/** Tests de l'identité « e-mail » du limiteur : normalisation, empreinte, cas invalides. */
import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { byEmail } from "../../../src/infrastructure/http/rate-limit-middleware.js";

const withBody = (body: unknown): Request => ({ body }) as unknown as Request;

describe("byEmail", () => {
  it("normalise la casse et les espaces : la même adresse donne la même identité", () => {
    const reference = byEmail(withBody({ email: "alice@example.com" }));
    expect(reference).not.toBeNull();
    expect(byEmail(withBody({ email: "  ALICE@Example.COM " }))).toBe(reference);
  });

  it("des adresses différentes donnent des identités différentes", () => {
    expect(byEmail(withBody({ email: "alice@example.com" }))).not.toBe(byEmail(withBody({ email: "bob@example.com" })));
  });

  it("ne contient jamais l'adresse en clair (empreinte hexadécimale de 32 caractères)", () => {
    const identity = byEmail(withBody({ email: "alice@example.com" }));
    expect(identity).toMatch(/^[0-9a-f]{32}$/);
    expect(identity).not.toContain("alice");
  });

  it("renvoie null (requête non comptée) si l'e-mail est absent, vide, trop long ou n'est pas une chaîne", () => {
    for (const body of [undefined, null, {}, { email: "" }, { email: 42 }, { email: ["a@b.c"] }, { email: "a".repeat(255) }]) {
      expect(byEmail(withBody(body))).toBeNull();
    }
  });
});
