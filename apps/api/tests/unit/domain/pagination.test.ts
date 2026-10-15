/** Tests unitaires du value object Pagination. */
import { describe, expect, it } from "vitest";
import { isErr, isOk } from "../../../src/domain/shared/result.js";
import { Pagination } from "../../../src/domain/value-objects/pagination.js";

describe("Pagination", () => {
  it("accepte les bornes valides, limite 50 incluse", () => {
    expect(isOk(Pagination.create(1, 1))).toBe(true);
    expect(isOk(Pagination.create(999, 50))).toBe(true);
  });

  it.each([
    [0, 10],
    [-1, 10],
    [1.5, 10],
    [Number.NaN, 10],
    [1, 0],
    [1, 51],
    [1, -5],
    [1, 2.5],
    [1, Number.NaN],
  ])("refuse page=%s limit=%s", (page, limit) => {
    const result = Pagination.create(page, limit);
    expect(isErr(result) && result.error.kind).toBe("InvalidPagination");
  });

  it("calcule le décalage (offset) SQL", () => {
    const result = Pagination.create(3, 10);
    expect(isOk(result) && result.value.offset).toBe(20);
    const first = Pagination.create(1, 25);
    expect(isOk(first) && first.value.offset).toBe(0);
  });

  it("expose les valeurs par défaut de la spec (page 1, limite 10, plafond 50)", () => {
    expect([Pagination.DEFAULT_PAGE, Pagination.DEFAULT_LIMIT, Pagination.MAX_LIMIT]).toEqual([1, 10, 50]);
  });
});
