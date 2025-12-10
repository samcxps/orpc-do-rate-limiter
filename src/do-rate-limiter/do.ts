import { DurableObject } from "cloudflare:workers";

export class RateLimiterDurableObject<
  Env = Cloudflare.Env,
  Props = unknown,
> extends DurableObject<Env, Props> {
  storage: DurableObjectStorage;

  constructor(ctx: DurableObjectState<Props>, env: Env) {
    super(ctx, env);
    this.storage = ctx.storage;
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

    let entry = await this.storage.get<{
      count: number;
      timestamp: number;
    }>(identifier);

    // No entry or window expired, initialize new window
    if (!entry || entry.timestamp < windowStart) {
      entry = { count: 1, timestamp: now };
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
    await this.storage.put(identifier, entry);

    return {
      success: true,
      remaining: max - entry.count,
      reset: entry.timestamp + windowMs,
      limit: max,
    };
  }
}
