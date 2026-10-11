# mailbox-mcp-email-worker

Accepts mail for registered mailboxes and stores it in R2. A single
**catch-all Email Routing rule** ("Send to a Worker" → this worker,
configured once in the dashboard) routes every address on the domain here;
the **mailbox registry** (a D1 database shared with the
[MCP worker](../mcp)) decides which addresses we handle: registered and
enabled mailboxes are stored, unknown or disabled addresses are rejected
with an SMTP bounce. The domain should be dedicated to mailbox-mcp.

There is deliberately no sending or forwarding; mailbox-mcp is receive-only.

## Storage layout

Each accepted message is stored in the `MAILBOX_STORE` R2 bucket under the
recipient mailbox's prefix:

```
<mailbox>/<sortKey>-<messageId>.eml     raw message
<mailbox>/<sortKey>-<messageId>.json    metadata
```

- `<mailbox>` is the envelope recipient address, lowercased.
- `<sortKey>-<messageId>` is the **message id** the messages API uses in its
  paths. `<sortKey>` is the receive time inverted against a fixed maximum
  (`9999999999999 - receivedAtMillis`, zero-padded to 13 digits), so plain
  string order is **newest first** — the messages API lists forward and pages
  correctly. `<messageId>` is the Message-ID header with unsafe characters
  replaced by `-` (angle brackets stripped), or a random 16-hex-digit slug
  when there is no usable Message-ID. The real receive time is in
  `metadata.receivedAt`.
- The metadata object is written last, so a metadata key always implies its
  raw message exists.

Metadata JSON shape (this is what the messages API serves for listings):

```json
{
  "id": "8239999999999-abc@example.com",
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

2. **Registry binding.** Set the shared D1 database ID in this directory's
   `wrangler.toml` (created as described in [the MCP worker's
   README](../mcp/README.md)).

3. **Deploy** from this directory (deploys the worker named
   `mailbox-mcp-email-worker`):

   ```sh
   npm install
   npm run deploy
   ```

4. **Catch-all rule.** In the dashboard (Email Routing → Routing Rules →
   Catch-all address → Edit): set the action to **Send to a Worker** and
   select `mailbox-mcp-email-worker`. This is a one-time, manual step — the
   worker accepts only registered, enabled mailboxes and bounces everything
   else.

## Development

```sh
npm install
npm run test        # vitest: key building, metadata, acceptance check, and the email handler
npm run typecheck   # tsc --noEmit
```