# DEVELOPING.md

Developer runbook for mailbox-mcp, which runs entirely on Cloudflare as a
single Worker: `workers/mcp` serves the MCP endpoint (with the mailbox
registry and message storage) **and** ingests mail via its `email` handler.
See [PRODUCT.md](PRODUCT.md) for scope and [AGENTS.md](AGENTS.md) for
working conventions.

> **Use a dedicated email domain.** A single catch-all routing rule routes
> mail for *every* address on the domain to the Worker, which bounces
> unknown addresses. The domain should be dedicated to mailbox-mcp.

## 1. Set up Cloudflare

1. **Wrangler.** Install Cloudflare's CLI and log in:

   ```sh
   npm install -g wrangler
   wrangler login     # browser OAuth flow
   wrangler whoami    # verify
   ```

   All `wrangler` commands below use this login; no API token is needed for
   deployments or for mailbox management. If your login sees more than one
   account, export `CLOUDFLARE_ACCOUNT_ID` (or add `account_id` to the
   wrangler.toml). Prefer not to install globally? Run commands as
   `npx wrangler ...` instead.

2. **Domain on Cloudflare.** The (dedicated) email domain must be a zone in
   your Cloudflare account, and set as `MAILBOX_MCP_DOMAIN` in
   `workers/mcp/wrangler.toml`.
3. **Enable Email Routing.** Dashboard → your domain → **Email → Email
   Routing** → enable. Cloudflare adds the required MX and SPF records.

## 2. Deploy

1. **Storage and registry.** Create the R2 bucket and the D1 registry, and
   apply the schema migration:

   ```sh
   npx wrangler r2 bucket create mailbox-mcp-store
   npx wrangler d1 create mailbox-mcp-registry
   ```

   Paste the database ID into `workers/mcp/wrangler.toml`, then:

   ```sh
   cd workers/mcp && npm install
   npx wrangler d1 migrations apply MAILBOX_MCP_REGISTRY --remote
   ```

2. **Deploy** the Worker and set its one secret:

   ```sh
   npx wrangler secret put MAILBOX_MCP_BEARER_TOKEN    # generate e.g. with: openssl rand -hex 32
   npm run deploy                            # applies pending migrations, then deploys
   ```

   The Worker then serves MCP as streamable HTTP at
   `https://mailbox-mcp.<account>.workers.dev/mcp`. The endpoint is
   protected by the bearer token only — keep `MAILBOX_MCP_BEARER_TOKEN` private.

## 3. Catch-all routing rule

In the dashboard: **Email Routing → Routing Rules → Catch-all address →
Edit** → action **Send to a Worker** → select `mailbox-mcp`.

Prefer the CLI? Do it with the Email Routing API instead (an API token with
**Zone → Email Routing Rules → Edit** permission required):

```sh
# 1. Get your zone ID for the domain
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones?name=$MAILBOX_MCP_DOMAIN"
# → .result[0].id

# 2. Point the catch-all rule at the Worker and enable it
curl -s -X PUT -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/email/routing/rules/catch_all" \
  --data '{"matchers":[{"type":"all"}],"actions":[{"type":"worker","value":["mailbox-mcp"]}],"name":"Catch-all to mailbox-mcp","enabled":true}'
```

This is a one-time, manual step. The catch-all routes mail for *every*
address on the domain to the Worker; the Worker accepts only addresses
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
      "headers": { "Authorization": "Bearer <MAILBOX_MCP_BEARER_TOKEN>" }
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

## Updating

- **CLI installs**: `git pull && npm install && npm run deploy` from
  `workers/mcp`. The deploy script applies any pending D1 migrations before
  deploying; migrations are append-only and safe to re-run.
- **Deploy-button installs**: the button sets up Cloudflare's git
  integration on your clone — **pushes deploy automatically**. To update,
  sync your clone with upstream and push. Rollback: the dashboard
  (Workers → mailbox-mcp → Deployments → Rollback) or deploy an older
  commit.

## Removing

Order matters: stop mail delivery first, then remove the Worker, then the
resources. **Deleting the Worker does not delete the D1 database or the R2
bucket** — remove those explicitly, or your stored mail stays behind:

1. Remove the catch-all rule (dashboard: Email Routing → Routing Rules →
   Catch-all address → set to drop or disable Email Routing for the domain).
2. Remove the Worker:

   ```sh
   cd workers/mcp && npx wrangler delete
   ```

3. Remove the resources (permanent — this deletes all stored mail):

   ```sh
   npx wrangler d1 delete mailbox-mcp-registry
   npx wrangler r2 bucket delete mailbox-mcp-store
   ```

Or run `npm run uninstall` from `workers/mcp`, which performs steps 2 and 3
(each asks for confirmation).

## Migrating an existing per-address deployment

Deployments from before the catch-all model have one Email Routing rule per
mailbox. Migrate in this order:

1. Create the D1 registry and apply the migration (section 2, step 1).
2. **Seed the registry with every existing mailbox** before deploying the
   acceptance-checking Worker — use `workers/mcp/seed.sql` as a template
   (`npx wrangler d1 execute mailbox-mcp-registry --remote --file seed.sql`).
   Unseeded addresses will bounce once the new Worker is live.
3. Deploy the new Worker (section 2, step 2).
4. Configure the catch-all rule (section 3).
5. Delete the old per-address routing rules in the dashboard, and remove the
   obsolete `CLOUDFLARE_API_TOKEN` secret from the Worker
   (`npx wrangler secret delete CLOUDFLARE_API_TOKEN`).

Old literal rules keep working until deleted (they take precedence over the
catch-all), so the migration is gradual and reversible up to step 5.

## Notes

- A disabled mailbox keeps existing and keeps its stored mail, but incoming
  mail is bounced with "Mailbox disabled"; enable it to resume delivery.