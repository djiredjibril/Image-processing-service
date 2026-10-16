/** Le fake en mémoire respecte le même contrat que l'implémentation Redis (avec une horloge contrôlée). */
import { describeRateLimiterContract } from "../../helpers/rate-limiter-contract.js";
import { InMemoryRateLimiter } from "../../fakes/in-memory-rate-limiter.js";

describeRateLimiterContract("InMemoryRateLimiter", () => {
  let now = 1_000_000;
  return Promise.resolve({
    limiter: new InMemoryRateLimiter(() => now),
    advance: (ms) => {
      now += ms;
      return Promise.resolve();
    },
  });
});
