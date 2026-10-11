# DEVELOPING.md

Developer runbook for trying out mailbox-mcp. Currently implemented: creating,
listing, and deleting mailboxes (Email Routing rules) on one domain. Reading
messages is not implemented yet — see [PRODUCT.md](PRODUCT.md) for scope.

## 1. Set up Cloudflare

1. **Domain on Cloudflare.** The email domain must be a zone in your Cloudflare
   account (nameservers pointed at Cloudflare).
2. **Enable Email Routing.** Dashboard → your domain → **Email → Email Routing**
   → enable. Cloudflare adds the required MX and SPF records. A catch-all rule
   is optional and can be disabled; mailbox-mcp manages individual rules.
3. **Email Worker.** Email Routing rules can only point to workers that exist
   in your account, so create a Worker named `mailbox-mcp-email-worker` first.
   For now a placeholder is fine:

   ```sh
   npm create cloudflare@latest -- mailbox-mcp-email-worker --type=hello-world
   cd mailbox-mcp-email-worker && npx wrangler deploy
   ```

   (The real worker that stores mail in R2 comes in a later iteration.)
4. **API token.** My Profile → **API Tokens → Create Token → Custom token**:
   permission **Zone → Email Routing Rules → Edit**, zone resources limited to
   your email domain's zone. Copy the token value — it is shown once.

## 2. Configure and run the MCP server

| Variable | Required | Example |
|---|---|---|
| `MAILBOX_MCP_CLOUDFLARE_API_TOKEN` | yes | the token from step 4 |
| `MAILBOX_MCP_DOMAIN` | yes | `mail.example.com` |
| `MAILBOX_MCP_EMAIL_WORKER` | no (default `mailbox-mcp-email-worker`) | — |
| `MAILBOX_MCP_TRANSPORT` | no (default `stdio`) | — |

Locally:

```sh
export MAILBOX_MCP_CLOUDFLARE_API_TOKEN=...
export MAILBOX_MCP_DOMAIN=mail.example.com
go run ./cmd/mailbox-mcp
```

Or via Docker:

```sh
docker build -t mailbox-mcp .
docker run -i --rm -e MAILBOX_MCP_CLOUDFLARE_API_TOKEN=... \
  -e MAILBOX_MCP_DOMAIN=mail.example.com mailbox-mcp
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
        "MAILBOX_MCP_DOMAIN": "mail.example.com"
      }
    }
  }
}
```

To use the Docker image instead, set `"command": "docker"` with
`"args": ["run", "-i", "--rm", "-e", "MAILBOX_MCP_CLOUDFLARE_API_TOKEN", "-e", "MAILBOX_MCP_DOMAIN=mail.example.com", "mailbox-mcp"]`.

Save, then hit **Refresh** in the MCP Servers panel; `mailbox-mcp` should show
the six tools (`create_mailbox`, `create_random_mailbox`, `list_mailboxes`,
`delete_mailbox`, `enable_mailbox`, `disable_mailbox`). Try it by asking Cline
to *"list mailboxes"*, then *"create a mailbox called alice"* and *"create a
random mailbox"*. Send an email to the created address — it should arrive at the
placeholder worker's logs (it is not stored yet). A disabled mailbox keeps
existing but stops receiving mail; enable it to resume delivery.