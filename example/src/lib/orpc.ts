import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import { ClientRetryPlugin } from "@orpc/client/plugins";
import type { RouterClient } from "@orpc/server";
import type { router } from "../../worker/router";

const link = new RPCLink({
  url: `${window.location.origin}/rpc`,
  plugins: [new ClientRetryPlugin()],
});

export const client: RouterClient<typeof router, ClientRetryPluginContext> =
  createORPCClient(link);
