interface RateLimitRecord {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private limits = new Map<string, RateLimitRecord>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number = 60, windowMs: number = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;

    // Periodically clean up expired records
    setInterval(() => this.cleanup(), 30_000).unref();
  }

  isAllowed(key: string): boolean {
    const now = Date.now();
    const record = this.limits.get(key);

    if (!record || now > record.resetAt) {
      this.limits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (record.count >= this.maxRequests) {
      return false;
    }

    record.count++;
    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.limits.entries()) {
      if (now > record.resetAt) {
        this.limits.delete(key);
      }
    }
  }
}
