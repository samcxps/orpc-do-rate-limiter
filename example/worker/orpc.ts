import { os } from "@orpc/server";
import type { CloudflareDurableRateLimiter } from "../../src/adapter";

type ORPCContext = {
  env: Env;
  rateLimiter: CloudflareDurableRateLimiter;
};

export const pub = os.$context<ORPCContext>();
