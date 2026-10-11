# DEVELOPING.md

Developer runbook for mailbox-mcp, which runs entirely on Cloudflare as two
Workers: `workers/mcp` (MCP endpoint + message storage) and
`workers/email-worker` (mail ingestion). See [PRODUCT.md](PRODUCT.md) for
scope and [AGENTS.md](AGENTS.md) for working conventions.

## 1. Set up Cloudflare

1. **Wrangler.** Install Cloudflare's CLI and log in — both workers are
   deployed with it:

   ```sh
   npm install -g wrangler
   wrangler login     # browser OAuth flow
   wrangler whoami    # verify
   ```

   All `wrangler` commands below use this login; no API token is needed for
   deployments. If your login sees more than one account, export
   `CLOUDFLARE_ACCOUNT_ID` (or add `account_id` to the wrangler.toml files).
   Prefer not to install globally? Run commands as `npx wrangler ...`.

2. **Domain on Cloudflare.** The email domain must be a zone in your
   Cloudflare account (nameservers pointed at Cloudflare), and set as
   `DOMAIN` in `workers/mcp/wrangler.toml`.
3. **Enable Email Routing.** Dashboard → your domain → **Email → Email
   Routing** → enable. Cloudflare adds the required MX and SPF records. A
   catch-all rule is optional and can be disabled; mailbox-mcp manages
   individual rules.
4. **Email Worker.** Create the R2 bucket and deploy the Email Worker:

   ```sh
   npx wrangler r2 bucket create mailbox-mcp-mailbox-store
   cd workers/email-worker && npm install && npm run deploy
   ```

   (Storage layout and details:
   [workers/email-worker/README.md](workers/email-worker/README.md).)

## 2. Deploy the MCP worker

```sh
cd workers/mcp && npm install
npx wrangler secret put CLOUDFLARE_API_TOKEN   # Email Routing Rules Edit token for DOMAIN
npx wrangler secret put MCP_AUTH_TOKEN         # generate e.g. with: openssl rand -hex 32
npm run deploy
```

The worker then serves MCP as streamable HTTP at
`https://mailbox-mcp.<account>.workers.dev/mcp`. The endpoint is protected
by the bearer token only — keep `MCP_AUTH_TOKEN` private.

## 3. Use it from an MCP client

Add the server as a remote MCP server (Cline → MCP Servers → add remote, or
the JSON form):

```json
{
  "mcpServers": {
    "mailbox-mcp": {
      "url": "https://mailbox-mcp.<account>.workers.dev/mcp",
      "headers": { "Authorization": "Bearer <MCP_AUTH_TOKEN>" }
    }
  }
}
```

`mailbox-mcp` should show the eleven tools (`create_mailbox`,
`create_random_mailbox`, `list_mailboxes`, `delete_mailbox`, `enable_mailbox`,
`disable_mailbox`, `list_messages`, `read_message`, `mark_message_read`,
`archive_message`, `delete_message`) and three prompts (`temporary-email`,
`verification-code`, `mailbox-summary`), and the initialize handshake
carries the agent guidance (what the server is for, that it cannot send
email, archive over delete — see
[issue #39](https://github.com/st3fan/mailbox-mcp/issues/39)).

Try it end to end by asking your agent to *"create a random mailbox"*, then —
after sending an email to the created address — *"list messages"* (the
message is stored by the Email Worker), *"read the newest message"* (reading
marks it as read automatically), *"archive it"* and *"delete it"*.

## Notes

- Freshly created mailboxes may bounce with "Address Not Found" for a short
  time while the new Email Routing rule takes effect — create the mailbox
  first, submit it to forms after, and retry a bounce after a minute or two
  ([issue #42](https://github.com/st3fan/mailbox-mcp/issues/42)).
- A disabled mailbox keeps existing but stops receiving mail; enable it to
  resume delivery.