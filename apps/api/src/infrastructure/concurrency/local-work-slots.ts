/**
 * Plafond de travaux simultanés, en mémoire du process.
 *
 * Couche : infrastructure. Implémente `IWorkSlots`. Le compteur est LOCAL au process : avec 3 instances de l'API, le plafond
 * global est 3 fois plus élevé (acceptable ici ; un plafond global demanderait un compteur partagé, par exemple dans Redis).
 */
import type { IWorkSlots, WorkSlot } from "../../domain/ports/work-slots.js";

/** Compteur de places en mémoire. */
export class LocalWorkSlots implements IWorkSlots {
  private active = 0;

  /**
   * Construit le plafond.
   *
   * @param max - Nombre maximal de travaux simultanés (entier >= 1).
   */
  constructor(private readonly max: number) {}

  /** Prend une place si elle est libre ; la place ne peut être rendue qu'une fois (un second `release` est sans effet). */
  tryAcquire(): WorkSlot | null {
    if (this.active >= this.max) return null;
    this.active += 1;
    let released = false;
    return {
      release: () => {
        if (!released) {
          released = true;
          this.active -= 1;
        }
      },
    };
  }
}
