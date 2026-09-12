export class RateLimitExceededError extends Error {
  public readonly retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number = 60) {
    super(`Rate Limit Exceeded: ${message}. Try again in ${retryAfterSeconds}s.`);
    this.name = 'RateLimitExceededError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(options: RateLimiterOptions = { windowMs: 60000, maxRequests: 60 }) {
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
  }

  /**
   * Checks whether an action key is permitted under current rate limits.
   * Throws RateLimitExceededError if rate limit is exceeded.
   */
  public check(key: string): void {
    const now = Date.now();
    const timestamps = this.hits.get(key) || [];
    const recent = timestamps.filter((t) => now - t < this.windowMs);

    if (recent.length >= this.maxRequests) {
      const oldest = recent[0];
      const retryAfterSeconds = Math.ceil((this.windowMs - (now - oldest)) / 1000);
      throw new RateLimitExceededError(
        `Operation limit of ${this.maxRequests} requests per ${Math.round(this.windowMs / 1000)}s reached for '${key}'`,
        retryAfterSeconds,
      );
    }

    recent.push(now);
    this.hits.set(key, recent);
  }

  /**
   * Resets rate tracking for a given key or all keys.
   */
  public reset(key?: string): void {
    if (key) {
      this.hits.delete(key);
    } else {
      this.hits.clear();
    }
  }
}
