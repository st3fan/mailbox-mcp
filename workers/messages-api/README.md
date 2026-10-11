# mailbox-mcp-messages-api

Cloudflare Worker exposing a small REST API over the messages the
[Email Worker](../email-worker) stores in R2. The MCP server's Go client
(`internal/messages` in the repository root) is the only intended consumer.
There is deliberately no send endpoint: mailbox-mcp is receive-only.

## Endpoints

All endpoints require `Authorization: Bearer <MESSAGES_API_TOKEN>`. Errors are
`{"error": "..."}` with an appropriate status (401 unauthorized, 400 invalid
input, 404 unknown mailbox/message, 405 wrong method).

| Method | Path | Description |
|---|---|---|
| `GET` | `/mailboxes/{address}/messages` | List messages: metadata only, newest first, paginated. Query: `limit` (default 50, max 200), `cursor` (page token from `nextPageToken`). |
| `GET` | `/mailboxes/{address}/messages/{id}` | Read one message: metadata plus the raw message as `raw`. |
| `POST` | `/mailboxes/{address}/messages/{id}/read` | Mark the message as read. |
| `POST` | `/mailboxes/{address}/messages/{id}/archive` | Archive the message. |
| `DELETE` | `/mailboxes/{address}/messages/{id}` | Delete the message (raw + metadata). |

Responses:

- **List:** `{"messages": [metadata...], "nextPageToken": "..." | null}` —
  `nextPageToken` is null when the mailbox is exhausted; pass it back as
  `cursor`.
- **Read:** `{"message": metadata, "raw": "..."}`.
- **Flags:** `{"message": metadata}` with the updated flags.
- **Delete:** `{"deleted": true}`.

`metadata` is the per-message object the Email Worker stores (see
[its README](../email-worker#storage-layout)): id, mailbox, from, to, subject,
receivedAt, size, read, archived.

Message ids are the key stems the Email Worker generates:
`<13-digit inverted receive time>-<sanitized Message-ID>`, chosen so that
ascending key order is newest first (see
[the Email Worker's README](../email-worker#storage-layout)).

## Setup

1. **Deploy** from this directory:

   ```sh
   npm install
   npm run deploy
   ```

2. **Set the API token** the MCP server will present:

   ```sh
   npx wrangler secret put MESSAGES_API_TOKEN
   ```

3. **Expose the worker** so the MCP server can reach it — a custom domain
   route on the worker (dashboard: Workers & Pages → mailbox-mcp-messages-api
   → Settings → Domains & Routes) or any route in front of it. Note the base
   URL: it becomes `MAILBOX_MCP_MESSAGES_API_URL` for the MCP server, and the
   token becomes `MAILBOX_MCP_MESSAGES_API_TOKEN`.

## Development

```sh
npm install
npm run test        # vitest: storage access and the full route surface
npm run typecheck   # tsc --noEmit
```