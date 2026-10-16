/** Fake de `IStatsCounters` en mémoire. */
import { type CounterName, type CounterValues, type IStatsCounters } from "../../src/domain/ports/monitoring.js";

/** Compteurs en mémoire : permet de vérifier ce que les use cases comptent. */
export class InMemoryStatsCounters implements IStatsCounters {
  readonly values: Record<CounterName, number> = { cache_hit: 0, cache_miss: 0, rate_limited: 0 };

  increment(name: CounterName): Promise<void> {
    this.values[name] += 1;
    return Promise.resolve();
  }

  readAll(): Promise<CounterValues> {
    return Promise.resolve({ ...this.values });
  }
}
