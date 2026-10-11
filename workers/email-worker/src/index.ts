// mailbox-mcp-email-worker: stores mail routed to mailbox-mcp mailboxes in R2.
//
// Email Routing rules created by mailbox-mcp route each mailbox address to
// this worker. Every received message is stored in the MAILBOX_STORE R2
// bucket: the raw message as `.eml`, its metadata as `.json`, under the
// mailbox's prefix (see keys.ts for the layout). There is deliberately no
// sending or forwarding: mailbox-mcp is receive-only.

import { buildMessageKeys } from "./keys";
import { newMetadata } from "./metadata";

export interface Env {
  /** R2 bucket the messages are stored in. */
  MAILBOX_STORE: R2Bucket;
}

export default {
  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
    const to = message.to.trim().toLowerCase();
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
    // last so the messages API only lists messages whose raw bytes exist.
    await env.MAILBOX_STORE.put(keys.raw, raw);
    await env.MAILBOX_STORE.put(keys.metadata, JSON.stringify(metadata), {
      httpMetadata: { contentType: "application/json" },
    });
  },
};