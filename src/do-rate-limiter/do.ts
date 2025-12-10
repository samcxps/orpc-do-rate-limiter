import { DurableObject } from "cloudflare:workers";

const CLEANUP_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

type RateLimitEntry = {
  count: number;
  timestamp: number;
  windowMs: number;
};

export class RateLimiterDurableObject<
  Env = Cloudflare.Env,
  Props = unknown,
> extends DurableObject<Env, Props> {
  storage: DurableObjectStorage;
  ctx: DurableObjectState<Props>;

  constructor(ctx: DurableObjectState<Props>, env: Env) {
    super(ctx, env);
    this.storage = ctx.storage;
    this.ctx = ctx;

    ctx.blockConcurrencyWhile(async () => {
      await this.scheduleCleanup();
    });
  }

  /**
   * Scheduled alarm handler to clean up expired rate limit entries.
   */
  async alarm(): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const entries = await this.storage.list<RateLimitEntry>();

      const expiredKeys: string[] = [];

      for (const [key, entry] of entries) {
        const expirationTime = entry.timestamp + entry.windowMs;

        if (expirationTime < now) {
          expiredKeys.push(key);
        }
      }

      if (expiredKeys.length > 0) {
        await this.storage.delete(expiredKeys);
      }

      // Reschedule the next cleanup
      const nextCleanup = Date.now() + CLEANUP_INTERVAL_MS;
      await this.storage.setAlarm(nextCleanup);
    });
  }

  /**
   * Limit a request based on the provided options.
   *
   * @param identifier - The identifier to limit
   * @param max - The maximum number of requests
   * @param windowMs - The window in milliseconds
   * @returns The result of the limit
   */
  async checkLimit(identifier: string, max: number, windowMs: number) {
    const now = Date.now();
    const windowStart = now - windowMs;

    let entry = await this.storage.get<RateLimitEntry>(identifier);

    // No entry or window expired, initialize new window
    if (!entry || entry.timestamp < windowStart) {
      entry = { count: 1, timestamp: now, windowMs };
      await this.storage.put(identifier, entry);

      return {
        success: true,
        remaining: max - 1,
        reset: now + windowMs,
        limit: max,
      };
    }

    // Rate limited
    if (entry.count >= max) {
      return {
        success: false,
        remaining: 0,
        reset: entry.timestamp + windowMs,
        limit: max,
      };
    }

    // Increment count
    entry.count += 1;
    entry.windowMs = windowMs; // Update windowMs in case it changed
    await this.storage.put(identifier, entry);

    return {
      success: true,
      remaining: max - entry.count,
      reset: entry.timestamp + windowMs,
      limit: max,
    };
  }

  /**
   * Ensures a cleanup alarm is scheduled.
   */
  private async scheduleCleanup(): Promise<void> {
    const existingAlarm = await this.storage.getAlarm();

    if (existingAlarm === null) {
      await this.storage.setAlarm(Date.now() + CLEANUP_INTERVAL_MS);
    }
  }
}
