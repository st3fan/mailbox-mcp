// mailbox-mcp MCP worker: serves the MCP endpoint (streamable HTTP at /mcp,
// bearer-token auth) AND ingests mail (the email handler accepts registered,
// enabled mailboxes routed by the catch-all rule and stores them in R2).
//
// The mailbox registry (D1, shared responsibilities split across modules)
// decides which addresses we handle; message storage lives in the
// MAILBOX_STORE R2 bucket. There is deliberately no sending or forwarding:
// mailbox-mcp is receive-only.

import { createMcpHandler } from "@modelcontextprotocol/server";

import type { Env } from "./env";
import { buildServer } from "./server";
import { buildMessageKeys } from "./keys";
import { newMetadata } from "./metadata";
import { getMailbox } from "./registry";

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

/** email is the ingestion handler: accepts mail for registered, enabled
 * mailboxes (registry lookup) and stores it in R2; everything else is
 * rejected with an SMTP bounce, matching the "Address Not Found" behavior
 * unknown addresses had under per-address routing rules. */
async function ingestEmail(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
  const to = message.to.trim().toLowerCase();

  // Acceptance check: only registered, enabled mailboxes receive mail.
  let mailbox;
  try {
    mailbox = await getMailbox(env.REGISTRY, to);
  } catch (err) {
    // Transient registry failure: throw so Email Routing defers and
    // retries delivery instead of bouncing real mail on a registry blip.
    throw new Error(`mailbox registry lookup failed: ${String(err)}`);
  }
  if (mailbox === null) {
    message.setReject("Address not found");
    return;
  }
  if (!mailbox.enabled) {
    message.setReject("Mailbox disabled");
    return;
  }

  const receivedAtMillis = Date.now();

  const raw = await new Response(message.raw).arrayBuffer();
  const keys = buildMessageKeys(to, receivedAtMillis, message.headers.get("message-id"));
  const metadata = newMetadata({
    id: keys.id,
    from: message.from,
    to,
    subject: message.headers.get("subject"),
    receivedAtMillis,
    size: raw.byteLength,
  });

  // Both objects under one put is not atomic, but the metadata is written
  // last so the message listing only shows messages whose raw bytes exist.
  await env.MAILBOX_STORE.put(keys.raw, raw);
  await env.MAILBOX_STORE.put(keys.metadata, JSON.stringify(metadata), {
    httpMetadata: { contentType: "application/json" },
  });
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

  email: ingestEmail,
};