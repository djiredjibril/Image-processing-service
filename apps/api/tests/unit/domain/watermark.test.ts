/** Tests unitaires du value object Watermark (texte sûr, position, opacité). */
import { describe, expect, it } from "vitest";
import { isErr, isOk } from "../../../src/domain/shared/result.js";
import { countCharacters, Watermark, WATERMARK_MAX_LENGTH, WATERMARK_POSITIONS } from "../../../src/domain/value-objects/watermark.js";

describe("Watermark", () => {
  it("accepte un texte simple, avec « bas-droite » et une opacité de 0,5 par défaut", () => {
    const result = Watermark.create({ text: "© Mon Studio" });
    expect(isOk(result) && [result.value.text, result.value.position, result.value.opacity]).toEqual(["© Mon Studio", "bottom-right", 0.5]);
  });

  it("nettoie les espaces autour du texte", () => {
    const result = Watermark.create({ text: "  Hello  " });
    expect(isOk(result) && result.value.text).toBe("Hello");
  });

  it.each(["Tom & Jerry's", "Café Été 2026", "Ça va ? Oui !", "日本語", "Привет", "a.b,c:d;e@f#g(h)_i-j", "école"])("accepte %j", (text) => {
    expect(isOk(Watermark.create({ text }))).toBe(true);
  });

  it("accepte exactement 30 caractères, refuse 31", () => {
    expect(isOk(Watermark.create({ text: "a".repeat(WATERMARK_MAX_LENGTH) }))).toBe(true);
    expect(isErr(Watermark.create({ text: "a".repeat(WATERMARK_MAX_LENGTH + 1) }))).toBe(true);
  });

  it("compte les caractères visibles : « é » décomposé vaut 1, pas 2", () => {
    expect(countCharacters("é")).toBe(1);
    expect(isOk(Watermark.create({ text: "é".repeat(WATERMARK_MAX_LENGTH) }))).toBe(true);
  });

  it.each(["", "   ", "<script>alert(1)</script>", "a<b", "a>b", 'a"b', "ligne1\nligne2", "tab\tici", "a\u0000b", "<svg/onload=alert(1)>", "emoji 😀", "a/b", "a\\b", "x=1", "{{x}}", "a%b", "$(rm)", "`cmd`"])(
    "refuse le texte dangereux ou hors liste blanche %j",
    (text) => {
      const result = Watermark.create({ text });
      expect(isErr(result) && result.error.kind).toBe("InvalidTransformation");
    },
  );

  it("accepte les cinq positions, refuse une position inconnue", () => {
    for (const position of WATERMARK_POSITIONS) expect(isOk(Watermark.create({ text: "x", position }))).toBe(true);
    for (const position of ["middle", "top", "", "BOTTOM-RIGHT"]) expect(isErr(Watermark.create({ text: "x", position }))).toBe(true);
  });

  it("opacité : de 0,1 à 1 inclus, refuse le reste", () => {
    for (const opacity of [0.1, 0.5, 1]) expect(isOk(Watermark.create({ text: "x", opacity }))).toBe(true);
    for (const opacity of [0, 0.09, 1.01, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(isErr(Watermark.create({ text: "x", opacity }))).toBe(true);
  });
});
