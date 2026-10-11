// mailbox-mcp MCP worker: serves the MCP endpoint as streamable HTTP at /mcp
// with bearer-token auth. Message storage lives in this worker (R2 binding);
// mail ingestion lives in workers/email-worker.

import { createMcpHandler } from "@modelcontextprotocol/server";

import type { Env } from "./env";
import { buildServer } from "./server";

const MCP_PATH = "/mcp";

function json(body: unknown, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** authorized checks the bearer token against the MCP_AUTH_TOKEN secret. */
function authorized(request: Request, env: Env): boolean {
  return request.headers.get("authorization") === `Bearer ${env.MCP_AUTH_TOKEN}`;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== MCP_PATH) {
      return json({ error: "not found" }, 404);
    }
    if (!authorized(request, env)) {
      return json(
        { error: "unauthorized" },
        401,
        { "www-authenticate": 'Bearer realm="mailbox-mcp"' },
      );
    }

    // Stateless serving: a fresh MCP server instance per request via the
    // factory; the SDK's handler does the streamable HTTP protocol work.
    const handler = createMcpHandler(() => buildServer(env));
    return handler.fetch(request);
  },
};