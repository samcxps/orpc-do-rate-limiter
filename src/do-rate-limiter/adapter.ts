/** biome-ignore-all lint/suspicious/noExplicitAny: <explanation> */

import type { Ratelimiter } from "@orpc/experimental-ratelimit";

type RatelimitOptions = {
  /**
   * The prefix to use for Redis keys.
   *
   * @default orpc:ratelimit:
   */
  prefix?: string;

  /**
   * Maximum number of requests allowed within the window.
   */
  maxRequests: number;

  /**
   * The duration of the sliding window in milliseconds.
   */
  window: number;
};

export class CloudflareDurableRateLimiter implements Ratelimiter {
  private readonly namespace: DurableObjectNamespace<any>;
  private readonly prefix: string;
  private readonly maxRequests: number;
  private readonly window: number;

  constructor(
    namespace: DurableObjectNamespace<any>,
    options: RatelimitOptions
  ) {
    this.namespace = namespace;
    this.prefix = options.prefix ?? "orpc:ratelimit:";
    this.maxRequests = options.maxRequests;
    this.window = options.window;
  }

  async limit(key: string) {
    const prefixedKey = `${this.prefix}${key}`;

    const stub = this.namespace.getByName(prefixedKey);

    return await stub.checkLimit(prefixedKey, this.maxRequests, this.window);
  }
}
