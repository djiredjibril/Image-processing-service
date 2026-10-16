/** Fakes de `IRateLimiter` pour les tests (sans Redis) : même sémantique de fenêtre fixe, horloge injectable. */
import type { IRateLimiter, RateLimitDecision, RateLimitPolicy } from "../../src/domain/ports/rate-limiter.js";

/** Limiteur en mémoire à fenêtre fixe ; l'horloge est injectable pour tester l'écoulement du temps. */
export class InMemoryRateLimiter implements IRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAtMs: number }>();

  /** @param now - Horloge en millisecondes (par défaut l'horloge réelle). */
  constructor(private readonly now: () => number = Date.now) {}

  consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision | null> {
    const at = this.now();
    let window = this.windows.get(key);
    if (window === undefined || window.resetAtMs <= at) {
      window = { count: 0, resetAtMs: at + policy.windowSeconds * 1000 };
      this.windows.set(key, window);
    }
    window.count += 1;
    return Promise.resolve({
      allowed: window.count <= policy.limit,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - window.count),
      resetSeconds: Math.max(1, Math.ceil((window.resetAtMs - at) / 1000)),
    });
  }
}

/** Limiteur « en panne » : renvoie toujours `null`, comme un vrai limiteur dont Redis est tombé. */
export class UnavailableRateLimiter implements IRateLimiter {
  consume(): Promise<RateLimitDecision | null> {
    return Promise.resolve(null);
  }
}
