import { ORPCError } from "@orpc/client";
import { createRatelimitMiddleware } from "@orpc/experimental-ratelimit";
import { pub } from "./orpc";

export const router = {
  notLimited: pub
    .route({
      method: "GET",
      path: "/hello-world",
    })
    .handler(async () => ({
      message: "Hello, world!",
    })),

  middlewareLimited: pub
    .route({
      method: "GET",
    })
    .use(
      createRatelimitMiddleware({
        limiter: ({ context }) => context.rateLimiter,
        key: () => "middleware-limited",
      })
    )
    .handler(async () => ({
      message: "Hello, rate limited world!",
    })),

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
