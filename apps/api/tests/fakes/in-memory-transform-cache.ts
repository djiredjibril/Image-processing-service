/** Fakes de `ITransformCache` pour les tests unitaires et E2E (sans Redis). */
import type { CacheLock, ITransformCache } from "../../src/domain/ports/transform-cache.js";
import type { TransformCacheKey } from "../../src/domain/value-objects/transform-cache-key.js";

/**
 * Cache en mémoire avec la MÊME sémantique que l'implémentation Redis : verrou exclusif, attente du résultat
 * d'une requête en cours. Permet de tester la protection contre les requêtes simultanées sans Redis.
 */
export class InMemoryTransformCache implements ITransformCache {
  readonly entries = new Map<string, string>();
  readonly lockedKeys = new Set<string>();
  private readonly listeners = new Map<string, (() => void)[]>();

  get(key: TransformCacheKey): Promise<string | null> {
    return Promise.resolve(this.entries.get(key.value) ?? null);
  }

  set(key: TransformCacheKey, derivedImageId: string): Promise<void> {
    this.entries.set(key.value, derivedImageId);
    this.notify(key.value);
    return Promise.resolve();
  }

  acquireLock(key: TransformCacheKey): Promise<CacheLock | null> {
    if (this.lockedKeys.has(key.value)) {
      return Promise.resolve(null);
    }
    this.lockedKeys.add(key.value);
    return Promise.resolve({
      release: () => {
        this.lockedKeys.delete(key.value);
        this.notify(key.value);
        return Promise.resolve();
      },
    });
  }

  async waitFor(key: TransformCacheKey, timeoutMs: number): Promise<string | null> {
    if (!this.entries.has(key.value) && this.lockedKeys.has(key.value)) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        this.listeners.set(key.value, [
          ...(this.listeners.get(key.value) ?? []),
          () => {
            clearTimeout(timer);
            resolve();
          },
        ]);
      });
    }
    return this.entries.get(key.value) ?? null;
  }

  /** Réveille ceux qui attendent cette clé. */
  private notify(keyValue: string): void {
    const waiting = this.listeners.get(keyValue) ?? [];
    this.listeners.delete(keyValue);
    for (const wake of waiting) wake();
  }
}

/** Cache « Redis tombé » : respecte le contrat fail-open (rien ne lève, tout se comporte comme un cache vide). */
export class UnavailableTransformCache implements ITransformCache {
  get(): Promise<string | null> {
    return Promise.resolve(null);
  }

  set(): Promise<void> {
    return Promise.resolve();
  }

  acquireLock(): Promise<CacheLock | null> {
    return Promise.resolve({ release: () => Promise.resolve() });
  }

  waitFor(): Promise<string | null> {
    return Promise.resolve(null);
  }
}
