# orpc-do-rate-limiter

Rate limiting for ORPC using Cloudflare Durable Objects.

## Setup

```typescript
// wrangler.jsonc
"durable_objects": {
  "bindings": [{ "name": "RATE_LIMITER_DO", "class_name": "RateLimiterDO" }]
},
"migrations": [
  {
    "tag": "new-rate-limiter-do",
    "new_classes": ["RateLimiterDO"]
  }
]
```

## Basic Usage

### Initialize the rate limiter and add it to context

```typescript
import { CloudflareDurableRateLimiter } from "./do-rate-limiter/adapter";

// Create rate limiter with 10 requests per 60 seconds
const rateLimiter = new CloudflareDurableRateLimiter(env.RATE_LIMITER_DO, {
  maxRequests: 10,
  window: 60_000, // milliseconds
});

// Add it to initial context
const rpcResult = await rpcHandler.handle(request, {
  prefix: "/rpc",
  context: {
    env,
    rateLimiter,
  },
});
```

### Middleware usage

```typescript
import { createRatelimitMiddleware } from "@orpc/experimental-ratelimit";

export const router = {
  middlewareLimitedRoute: pub
    .route({
      method: "GET",
    })
    .use(
      createRatelimitMiddleware({
        limiter: ({ context }) => context.rateLimiter,
        key: () => "middleware-limited", // Rate limit key
      })
    )
    .handler(async () => ({
      message: "Hello, rate limited world!",
    })),
};
```

### Direct usage

```typescript
import { ORPCError } from "@orpc/client";

export const router = {
  directUsageLimited: pub
    .route({
      method: "GET",
      path: "/hello-world-limited",
    })
    .handler(async ({ context }) => {
      const result = await context.rateLimiter.limit("direct-usage-limited");

      if (!result.success) {
        throw new ORPCError("TOO_MANY_REQUESTS");
      }

      return {
        message: "Hello, direct usage rate limited world!",
      };
    }),
};
```

## Configuration

- `maxRequests`: Maximum number of requests allowed within the window
- `window`: Duration of the sliding window in milliseconds
- `prefix`: Optional prefix for rate limit keys (default: `"orpc:ratelimit:"`)
