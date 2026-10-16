/** Tests du plafond de travaux simultanés en mémoire. */
import { describe, expect, it } from "vitest";
import { UNLIMITED_WORK_SLOTS } from "../../../src/domain/ports/work-slots.js";
import { LocalWorkSlots } from "../../../src/infrastructure/concurrency/local-work-slots.js";

describe("LocalWorkSlots", () => {
  it("accorde au plus `max` places, puis refuse sans attendre (null)", () => {
    const slots = new LocalWorkSlots(2);
    expect(slots.tryAcquire()).not.toBeNull();
    expect(slots.tryAcquire()).not.toBeNull();
    expect(slots.tryAcquire()).toBeNull();
  });

  it("rend la place libérée, qui peut être reprise", () => {
    const slots = new LocalWorkSlots(1);
    const first = slots.tryAcquire();
    expect(slots.tryAcquire()).toBeNull();
    first?.release();
    expect(slots.tryAcquire()).not.toBeNull();
  });

  it("un `release` répété n'a d'effet qu'une fois (sinon le plafond serait contourné)", () => {
    const slots = new LocalWorkSlots(1);
    const first = slots.tryAcquire();
    first?.release();
    first?.release();
    first?.release();
    expect(slots.tryAcquire()).not.toBeNull();
    expect(slots.tryAcquire()).toBeNull(); // une seule place a été rendue, pas trois
  });

  it("chaque instance a son propre compteur", () => {
    const a = new LocalWorkSlots(1);
    const b = new LocalWorkSlots(1);
    a.tryAcquire();
    expect(b.tryAcquire()).not.toBeNull();
  });

  it("le plafond « sans limite » accorde toujours une place", () => {
    for (let i = 0; i < 1000; i++) expect(UNLIMITED_WORK_SLOTS.tryAcquire()).not.toBeNull();
  });
});
