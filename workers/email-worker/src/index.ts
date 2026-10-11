// mailbox-mcp-email-worker: accepts mail for registered mailboxes and stores
// it in R2.
//
// A catch-all Email Routing rule routes every address on the domain to this
// worker; the mailbox registry (shared D1 database) decides which addresses
// we handle: registered and enabled mailboxes are stored, everything else is
// rejected with an SMTP bounce. Every received message is stored in the
// MAILBOX_STORE R2 bucket: the raw message as `.eml`, its metadata as
// `.json`, under the mailbox's prefix (see keys.ts for the layout). There is
// deliberately no sending or forwarding: mailbox-mcp is receive-only.

import { buildMessageKeys } from "./keys";
import { newMetadata } from "./metadata";
import { getMailbox } from "./registry";

export interface Env {
  /** R2 bucket the messages are stored in. */
  MAILBOX_STORE: R2Bucket;

  /** D1 database holding the mailbox registry (shared with the MCP worker). */
  REGISTRY: D1Database;
}

export default {
  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
    const to = message.to.trim().toLowerCase();

    // Acceptance check: only registered, enabled mailboxes receive mail.
    // Everything else is rejected with an SMTP bounce, matching the
    // "Address Not Found" behavior unknown addresses had under per-address
    // routing rules.
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
  },
};