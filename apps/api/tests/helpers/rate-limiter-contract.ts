/** Contrat de comportement d'un `IRateLimiter`, exécuté contre le fake (unit) ET contre Redis (intégration). */
import { describe, expect, it } from "vitest";
import type { IRateLimiter, RateLimitPolicy } from "../../src/domain/ports/rate-limiter.js";

/** Ce que le contrat a besoin de piloter : le limiteur, et un moyen de faire passer le temps. */
export interface LimiterHarness {
  readonly limiter: IRateLimiter;
  /** Fait avancer le temps d'au moins `ms` millisecondes (horloge fausse, ou vraie attente pour Redis). */
  readonly advance: (ms: number) => Promise<void>;
}

const POLICY: RateLimitPolicy = { limit: 3, windowSeconds: 1 };

/**
 * Déclare les tests de contrat.
 *
 * @param name - Nom de l'implémentation testée.
 * @param create - Fabrique un limiteur NEUF (compteurs vides) pour chaque test.
 */
export function describeRateLimiterContract(name: string, create: () => Promise<LimiterHarness>): void {
  describe(`contrat IRateLimiter : ${name}`, () => {
    it("accepte jusqu'à la limite puis refuse, avec un « remaining » décroissant", async () => {
      const { limiter } = await create();
      const decisions = [];
      for (let i = 0; i < 5; i++) decisions.push(await limiter.consume("k", POLICY));
      expect(decisions.map((d) => d?.allowed)).toEqual([true, true, true, false, false]);
      expect(decisions.map((d) => d?.remaining)).toEqual([2, 1, 0, 0, 0]);
      expect(decisions[0]?.limit).toBe(3);
    });

    it("indique un délai de réinitialisation entre 1 s et la durée de la fenêtre", async () => {
      const { limiter } = await create();
      const decision = await limiter.consume("k", POLICY);
      expect(decision?.resetSeconds).toBeGreaterThanOrEqual(1);
      expect(decision?.resetSeconds).toBeLessThanOrEqual(POLICY.windowSeconds);
    });

    it("compte séparément chaque clé", async () => {
      const { limiter } = await create();
      for (let i = 0; i < 4; i++) await limiter.consume("alice", POLICY);
      expect((await limiter.consume("alice", POLICY))?.allowed).toBe(false);
      expect((await limiter.consume("bob", POLICY))?.allowed).toBe(true);
    });

    it("repart de zéro quand la fenêtre est écoulée", async () => {
      const { limiter, advance } = await create();
      for (let i = 0; i < 4; i++) await limiter.consume("k", POLICY);
      expect((await limiter.consume("k", POLICY))?.allowed).toBe(false);
      await advance(1200);
      const decision = await limiter.consume("k", POLICY);
      expect(decision?.allowed).toBe(true);
      expect(decision?.remaining).toBe(2);
    });

    it("la fenêtre est FIXE : refuser n'est pas prolongé par les requêtes refusées", async () => {
      const { limiter, advance } = await create();
      await limiter.consume("k", POLICY);
      await advance(600);
      for (let i = 0; i < 5; i++) await limiter.consume("k", POLICY); // dépasse la limite pendant la fenêtre
      await advance(600); // 1,2 s depuis la 1re requête : la fenêtre doit être terminée
      expect((await limiter.consume("k", POLICY))?.allowed).toBe(true);
    });

    it("reste exact sous charge simultanée : exactement `limit` acceptées sur 20", async () => {
      const { limiter } = await create();
      const decisions = await Promise.all(Array.from({ length: 20 }, () => limiter.consume("k", { limit: 7, windowSeconds: 30 })));
      expect(decisions.filter((d) => d?.allowed).length).toBe(7);
    });
  });
}
