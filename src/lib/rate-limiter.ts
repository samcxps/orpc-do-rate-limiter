import { MemoryRatelimiter } from "@orpc/experimental-ratelimit/memory";

export const memoryRatelimiter = new MemoryRatelimiter({
  maxRequests: 10, // Maximum requests allowed
  window: 60_000, // Time window in milliseconds (60 seconds)
});
