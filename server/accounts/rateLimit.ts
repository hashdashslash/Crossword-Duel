/** Counts events per key in a sliding window (in memory; one server process). */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private max: number, private windowMs: number) {}

  private recent(key: string, now: number): number[] {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  /** True if this key has used up its allowance. */
  blocked(key: string, now = Date.now()): boolean {
    return this.recent(key, now).length >= this.max;
  }

  /** Seconds until the key is allowed again (0 if allowed now). */
  retryAfter(key: string, now = Date.now()): number {
    const list = this.recent(key, now);
    if (list.length < this.max) return 0;
    return Math.ceil((list[0]! + this.windowMs - now) / 1000);
  }

  hit(key: string, now = Date.now()) {
    this.hits.set(key, [...this.recent(key, now), now]);
    if (this.hits.size > 50_000) this.hits.delete(this.hits.keys().next().value!);
  }

  reset(key: string) {
    this.hits.delete(key);
  }
}
