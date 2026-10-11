# DEVELOPING.md

Developer runbook for trying out mailbox-mcp. Currently implemented: creating,
listing, and deleting mailboxes (Email Routing rules) on one domain, and
reading and managing the messages those mailboxes receive. See
[PRODUCT.md](PRODUCT.md) for scope.

## 1. Set up Cloudflare

1. **Wrangler.** Install Cloudflare's CLI and log in — both workers below are
   deployed with it:

   ```sh
   npm install -g wrangler
   wrangler login
   ```

   `wrangler login` opens a browser for the Cloudflare OAuth flow; approve it
   to grant the CLI access to your account. Check it worked with:

   ```sh
   wrangler whoami
   ```

   It should print your account. All `wrangler` commands below (`npm run
   deploy`, `wrangler secret put`) use this login — no separate API token is
   needed for deployments. If you prefer not to install globally, skip the
   install and run the commands as `npx wrangler ...` instead; npm downloads
   the CLI on first use (and the worker directories pin wrangler as a dev
   dependency, so `npm run deploy` inside them uses the pinned version).
2. **Domain on Cloudflare.** The email domain must be a zone in your Cloudflare
   account (nameservers pointed at Cloudflare).
3. **Enable Email Routing.** Dashboard → your domain → **Email → Email Routing**
   → enable. Cloudflare adds the required MX and SPF records. A catch-all rule
   is optional and can be disabled; mailbox-mcp manages individual rules.
4. **Email Worker.** Email Routing rules can only point to workers that exist
   in your account, so create the R2 bucket and deploy the in-repo Email
   Worker first:

   ```sh
   npx wrangler r2 bucket create mailbox-mcp-mailbox-store
   cd workers/email-worker && npm install && npm run deploy
   ```

   (Storage layout and deployment details:
   [workers/email-worker/README.md](workers/email-worker/README.md).)
5. **Messages API.** Deploy the messages API worker, set its API token, and
   expose it on a URL the MCP server can reach:

   ```sh
   cd workers/messages-api && npm install && npm run deploy
   npx wrangler secret put MESSAGES_API_TOKEN
   ```

   Then create a route/custom domain for it (dashboard: Workers & Pages →
   mailbox-mcp-messages-api → Settings → Domains & Routes). Details:
   [workers/messages-api/README.md](workers/messages-api/README.md).
6. **API token.** My Profile → **API Tokens → Create Token → Custom token**:
   permission **Zone → Email Routing Rules → Edit**, zone resources limited to
   your email domain's zone. Copy the token value — it is shown once. This
   token is for the MCP server's Email Routing calls; wrangler deployments
   from step 1's login do not use it.

## 2. Configure and run the MCP server

| Variable | Required | Example |
|---|---|---|
| `MAILBOX_MCP_CLOUDFLARE_API_TOKEN` | yes | the token from step 6 |
| `MAILBOX_MCP_DOMAIN` | yes | `mail.example.com` |
| `MAILBOX_MCP_EMAIL_WORKER` | no (default `mailbox-mcp-email-worker`) | — |
| `MAILBOX_MCP_TRANSPORT` | no (default `stdio`) | — |
| `MAILBOX_MCP_MESSAGES_API_URL` | yes | `https://messages.example.com` |
| `MAILBOX_MCP_MESSAGES_API_TOKEN` | yes | the token from step 5 |

Locally — either export the variables from the table above, or keep a `.env`
file in the repo root (gitignored) and let the server read it itself:

```sh
go run ./cmd/mailbox-mcp
```

Or via Docker — mount a `.env` into the container's working directory:

```sh
docker build -t mailbox-mcp .
docker run -i --rm -v "$PWD/.env:/.env:ro" mailbox-mcp
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

If the server is launched with the repository as its working directory, the
`env` block can be omitted entirely: the server reads `.env` from its working
directory itself.

To use the Docker image instead, set `"command": "docker"` and mount a `.env`
file (the container's working directory is `/`):

`"args": ["run", "-i", "--rm", "-v", "/absolute/path/to/.env:/.env:ro", "mailbox-mcp"]`.

Save, then hit **Refresh** in the MCP Servers panel; `mailbox-mcp` should show
the eleven tools (`create_mailbox`, `create_random_mailbox`, `list_mailboxes`,
`delete_mailbox`, `enable_mailbox`, `disable_mailbox`, `list_messages`,
`read_message`, `mark_message_read`, `archive_message`, `delete_message`) and
three prompts (`temporary-email`, `verification-code`, `mailbox-summary`).
The server also advertises instructions in the initialize handshake, telling
agents what the server is for, that it cannot send email, and to prefer
archiving over deleting (see
[issue #39](https://github.com/st3fan/mailbox-mcp/issues/39)). Try
it end to end by asking Cline to *"list mailboxes"*, then *"create a random
mailbox"*, then — after sending an email to the created address — *"list
messages"* (the message is stored by the Email Worker), *"read the newest
message"*, *"mark it read"*, *"archive it"* and *"delete it"*. A disabled
mailbox keeps existing but stops receiving mail; enable it to resume delivery.