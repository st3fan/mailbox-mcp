# mailbox-mcp-email-worker

Cloudflare Email Worker for [mailbox-mcp](../../): it receives mail routed to
mailbox-mcp mailbox addresses and stores each message in an R2 bucket. There is
deliberately no sending or forwarding; mailbox-mcp is receive-only.

Mail reaches this worker because mailbox-mcp's routing rules (one per mailbox
address) route mail to the worker named in this directory's `wrangler.toml`.
No catch-all rule is used.

## Storage layout

Each received message is stored in the `MAILBOX_STORE` R2 bucket under the
recipient mailbox's prefix:

```
<mailbox>/<receivedAtMillis>-<messageId>.eml     raw message
<mailbox>/<receivedAtMillis>-<messageId>.json    metadata
```

- `<mailbox>` is the envelope recipient address, lowercased.
- `<receivedAtMillis>-<messageId>` is the **message id** the messages API uses
  in its paths: the receive time in epoch milliseconds, then the Message-ID
  header with unsafe characters replaced by `-` (angle brackets stripped), or a
  random 16-hex-digit slug when there is no usable Message-ID.
- Sorting keys as strings sorts a mailbox's messages oldest first.
- The metadata object is written last, so a metadata key always implies its
  raw message exists.

Metadata JSON shape (this is what the messages API serves for listings):

```json
{
  "id": "1760000000000-abc@example.com",
  "mailbox": "alice@outofscope.party",
  "from": "sender@example.com",
  "to": "alice@outofscope.party",
  "subject": "Hello",
  "receivedAt": "2026-01-02T03:04:05.000Z",
  "size": 1234,
  "read": false,
  "archived": false
}
```

## Setup

1. **R2 bucket** (one per account is enough; both workers share it):

   ```sh
   npx wrangler r2 bucket create mailbox-mcp-mailbox-store
   ```

2. **Deploy** from this directory (deploys the worker named
   `mailbox-mcp-email-worker`):

   ```sh
   npm install
   npm run deploy
   ```

3. **Point mailboxes at it.** Nothing to do manually: mailbox-mcp routing
   rules route mail to this worker by name (see the `MAILBOX_MCP_EMAIL_WORKER`
   setting of the MCP server).

This replaces the placeholder hello-world worker from the iteration 1
runbook: deploy this worker instead of creating a placeholder.

## Development

```sh
npm install
npm run test        # vitest: key building, metadata, and the email handler
npm run typecheck   # tsc --noEmit
```

The messages API worker that reads this bucket lives in
[`../messages-api`](../messages-api).