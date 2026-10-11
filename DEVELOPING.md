# DEVELOPING.md

Developer runbook for trying out mailbox-mcp. Currently implemented: creating,
listing, and deleting mailboxes (Email Routing rules) on one domain, and
reading and managing the messages those mailboxes receive. See
[PRODUCT.md](PRODUCT.md) for scope.

## 1. Set up Cloudflare

1. **Domain on Cloudflare.** The email domain must be a zone in your Cloudflare
   account (nameservers pointed at Cloudflare).
2. **Enable Email Routing.** Dashboard → your domain → **Email → Email Routing**
   → enable. Cloudflare adds the required MX and SPF records. A catch-all rule
   is optional and can be disabled; mailbox-mcp manages individual rules.
3. **Email Worker.** Email Routing rules can only point to workers that exist
   in your account, so create the R2 bucket and deploy the in-repo Email
   Worker first:

   ```sh
   npx wrangler r2 bucket create mailbox-mcp-mailbox-store
   cd workers/email-worker && npm install && npm run deploy
   ```

   (Storage layout and deployment details:
   [workers/email-worker/README.md](workers/email-worker/README.md).)
4. **Messages API.** Deploy the messages API worker, set its API token, and
   expose it on a URL the MCP server can reach:

   ```sh
   cd workers/messages-api && npm install && npm run deploy
   npx wrangler secret put MESSAGES_API_TOKEN
   ```

   Then create a route/custom domain for it (dashboard: Workers & Pages →
   mailbox-mcp-messages-api → Settings → Domains & Routes). Details:
   [workers/messages-api/README.md](workers/messages-api/README.md).
5. **API token.** My Profile → **API Tokens → Create Token → Custom token**:
   permission **Zone → Email Routing Rules → Edit**, zone resources limited to
   your email domain's zone. Copy the token value — it is shown once.

## 2. Configure and run the MCP server

| Variable | Required | Example |
|---|---|---|
| `MAILBOX_MCP_CLOUDFLARE_API_TOKEN` | yes | the token from step 5 |
| `MAILBOX_MCP_DOMAIN` | yes | `mail.example.com` |
| `MAILBOX_MCP_EMAIL_WORKER` | no (default `mailbox-mcp-email-worker`) | — |
| `MAILBOX_MCP_TRANSPORT` | no (default `stdio`) | — |
| `MAILBOX_MCP_MESSAGES_API_URL` | yes | `https://messages.example.com` |
| `MAILBOX_MCP_MESSAGES_API_TOKEN` | yes | the token from step 4 |

Locally:

```sh
export MAILBOX_MCP_CLOUDFLARE_API_TOKEN=...
export MAILBOX_MCP_DOMAIN=mail.example.com
export MAILBOX_MCP_MESSAGES_API_URL=https://messages.example.com
export MAILBOX_MCP_MESSAGES_API_TOKEN=...
go run ./cmd/mailbox-mcp
```

Or via Docker:

```sh
docker build -t mailbox-mcp .
docker run -i --rm -e MAILBOX_MCP_CLOUDFLARE_API_TOKEN=... \
  -e MAILBOX_MCP_DOMAIN=mail.example.com \
  -e MAILBOX_MCP_MESSAGES_API_URL=... \
  -e MAILBOX_MCP_MESSAGES_API_TOKEN=... mailbox-mcp
```

The server fails fast at startup if the token/domain is missing or the domain
does not resolve to a zone the token can see — fix the error it prints before
continuing.

## 3. Use it from Cline

Add the server to Cline's MCP settings (Cline → MCP Servers icon →
*Configure*, which opens `cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "mailbox-mcp": {
      "command": "go",
      "args": ["run", "./cmd/mailbox-mcp"],
      "env": {
        "MAILBOX_MCP_CLOUDFLARE_API_TOKEN": "...",
        "MAILBOX_MCP_DOMAIN": "mail.example.com",
        "MAILBOX_MCP_MESSAGES_API_URL": "https://messages.example.com",
        "MAILBOX_MCP_MESSAGES_API_TOKEN": "..."
      }
    }
  }
}
```

To use the Docker image instead, set `"command": "docker"` with `"args"` adding
`-e MAILBOX_MCP_MESSAGES_API_URL` and `-e MAILBOX_MCP_MESSAGES_API_TOKEN`.

Save, then hit **Refresh** in the MCP Servers panel; `mailbox-mcp` should show
the eleven tools (`create_mailbox`, `create_random_mailbox`, `list_mailboxes`,
`delete_mailbox`, `enable_mailbox`, `disable_mailbox`, `list_messages`,
`read_message`, `mark_message_read`, `archive_message`, `delete_message`). Try
it end to end by asking Cline to *"list mailboxes"*, then *"create a random
mailbox"*, then — after sending an email to the created address — *"list
messages"* (the message is stored by the Email Worker), *"read the newest
message"*, *"mark it read"*, *"archive it"* and *"delete it"*. A disabled
mailbox keeps existing but stops receiving mail; enable it to resume delivery.