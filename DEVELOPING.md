# DEVELOPING.md

Developer runbook for mailbox-mcp, which runs entirely on Cloudflare as two
Workers: `workers/mcp` (MCP endpoint + mailbox registry + message storage)
and `workers/email-worker` (mail ingestion). See [PRODUCT.md](PRODUCT.md)
for scope and [AGENTS.md](AGENTS.md) for working conventions.

> **Use a dedicated email domain.** A single catch-all routing rule routes
> mail for *every* address on the domain to the email worker, which bounces
> unknown addresses. The domain should be dedicated to mailbox-mcp.

## 1. Set up Cloudflare

1. **Wrangler.** Install Cloudflare's CLI and log in — both workers are
   deployed with it:

   ```sh
   npm install -g wrangler
   wrangler login     # browser OAuth flow
   wrangler whoami    # verify
   ```

   All `wrangler` commands below use this login; no API token is needed for
   deployments or for mailbox management. If your login sees more than one
   account, export `CLOUDFLARE_ACCOUNT_ID` (or add `account_id` to the
   wrangler.toml files). Prefer not to install globally? Run commands as
   `npx wrangler ...` instead.

2. **Domain on Cloudflare.** The (dedicated) email domain must be a zone in
   your Cloudflare account, and set as `DOMAIN` in
   `workers/mcp/wrangler.toml`.
3. **Enable Email Routing.** Dashboard → your domain → **Email → Email
   Routing** → enable. Cloudflare adds the required MX and SPF records.
4. **Email Worker.** Create the R2 bucket and deploy the Email Worker:

   ```sh
   npx wrangler r2 bucket create mailbox-mcp-mailbox-store
   cd workers/email-worker && npm install && npm run deploy
   ```

   (Storage layout and details:
   [workers/email-worker/README.md](workers/email-worker/README.md).)

## 2. Deploy the MCP worker

1. **Mailbox registry (D1).** Create the database, apply the schema
   migration, and paste the database ID into **both** workers'
   `wrangler.toml` files:

   ```sh
   npx wrangler d1 create mailbox-registry
   npx wrangler d1 migrations apply mailbox-registry --remote
   ```

2. **Deploy** the MCP worker and set its one secret:

   ```sh
   cd workers/mcp && npm install
   npx wrangler secret put MCP_AUTH_TOKEN    # generate e.g. with: openssl rand -hex 32
   npm run deploy
   ```

   The worker then serves MCP as streamable HTTP at
   `https://mailbox-mcp.<account>.workers.dev/mcp`. The endpoint is
   protected by the bearer token only — keep `MCP_AUTH_TOKEN` private.

## 3. Catch-all routing rule

In the dashboard: **Email Routing → Routing Rules → Catch-all address →
Edit** → action **Send to a Worker** → select `mailbox-mcp-email-worker`.

This is a one-time, manual step. The catch-all routes mail for *every*
address on the domain to the worker; the worker accepts only addresses
registered in the mailbox registry and bounces everything else with
"Address not found".

## 4. Use it from an MCP client

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
`create_random_mailbox`, `list_mailboxes`, `delete_mailbox`,
`enable_mailbox`, `disable_mailbox`, `list_messages`, `read_message`,
`mark_message_read`, `archive_message`, `delete_message`) and three prompts
(`temporary-email`, `verification-code`, `mailbox-summary`), and the
initialize handshake carries the agent guidance (what the server is for,
that it cannot send email, archive over delete — see
[issue #39](https://github.com/st3fan/mailbox-mcp/issues/39)).

Try it end to end by asking your agent to *"create a random mailbox"* — the
address **immediately receives mail** (no routing-rule activation delay) —
then, after sending an email to it, *"list messages"*, *"read the newest
message"* (reading marks it as read automatically), *"archive it"* and
*"delete it"*.

## Migrating an existing per-address deployment

Deployments from before the catch-all model have one Email Routing rule per
mailbox. Migrate in this order:

1. Create the D1 registry and apply the migration (section 2, step 1).
2. **Seed the registry with every existing mailbox** before deploying the
   new email worker — use `workers/mcp/seed.sql` as a template
   (`npx wrangler d1 execute mailbox-registry --remote --file seed.sql`).
   Unseeded addresses will bounce once the new email worker is live.
3. Deploy the new MCP worker and email worker.
4. Configure the catch-all rule (section 3).
5. Delete the old per-address routing rules in the dashboard, and remove the
   obsolete `CLOUDFLARE_API_TOKEN` secret from the MCP worker
   (`npx wrangler secret delete CLOUDFLARE_API_TOKEN`).

Old literal rules keep working until deleted (they take precedence over the
catch-all), so the migration is gradual and reversible up to step 5.

## Notes

- A disabled mailbox keeps existing and keeps its stored mail, but incoming
  mail is bounced with "Mailbox disabled"; enable it to resume delivery.