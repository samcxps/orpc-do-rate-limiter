import { onError } from "@orpc/client";
import { RatelimitHandlerPlugin } from "@orpc/experimental-ratelimit";
import { RPCHandler } from "@orpc/server/fetch";
import { CloudflareDurableRateLimiter } from "./do-rate-limiter/adapter";
import { RateLimiterDurableObject } from "./do-rate-limiter/do";
import { router } from "./router";

const rpcHandler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
  plugins: [new RatelimitHandlerPlugin()],
});

export default {
  async fetch(request, env): Promise<Response> {
    const rateLimiter = new CloudflareDurableRateLimiter(env.RATE_LIMITER_DO, {
      maxRequests: 10,
      window: 60_000,
    });

    const rpcResult = await rpcHandler.handle(request, {
      prefix: "/rpc",
      context: {
        env,
        rateLimiter,
      },
    });

    if (rpcResult.matched) {
      return rpcResult.response;
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

export class RateLimiterDO extends RateLimiterDurableObject {}
