# mailbox-mcp

mailbox-mcp is an MCP server for **temporary email addresses that actually
receive mail**, running entirely on Cloudflare. With a domain onboarded to
Cloudflare Email Routing, it creates and manages mailboxes — addresses whose
mail is routed by a single catch-all Email Routing rule to the Worker
and stored in R2 — and lets agents read and manage the mail they receive.

The project is about **creating temporary email addresses, receiving email,
and managing the mailbox**. It deliberately has no functionality to send
email.

> **Use a dedicated domain.** The catch-all rule routes mail for *every*
> address on the domain to the worker, and unknown addresses are bounced.
> The domain should therefore be dedicated to mailbox-mcp — a domain shared
> with personal or other mail is not suitable.

## Architecture

Everything runs on Cloudflare as a single Worker with two entry points:

1. **`email` handler** — receives mail routed by the catch-all rule, accepts
   only registered, enabled mailboxes (via the mailbox registry), and stores
   accepted mail in R2.
2. **`fetch` handler** — serves the MCP endpoint as streamable HTTP at
   `/mcp` (bearer-token auth), owns the mailbox registry (a D1 database)
   and message storage (direct R2 access).

Agents connect to `https://mailbox-mcp.<account>.workers.dev/mcp` as a
remote MCP server.

## Tools

| Tool | Description |
|---|---|
| `create_mailbox` | Create a mailbox: register the address. It immediately receives mail. |
| `create_random_mailbox` | Create a mailbox with a generated address like `john.smith@domain`. |
| `list_mailboxes` | List the registered mailboxes, sorted by address. |
| `delete_mailbox` | Delete a mailbox: the address no longer receives mail and all of its stored messages are permanently deleted. |
| `enable_mailbox` | Re-activate a mailbox: mail to the address is accepted again. |
| `disable_mailbox` | De-activate a mailbox: incoming mail is bounced; the mailbox and its stored messages remain. |
| `list_messages` | List a mailbox's messages, newest first, paginated. Never marks messages read. |
| `read_message` | Read one message: metadata and raw content. Marks the message as read automatically. |
| `mark_message_read` | Mark a message as read without re-reading it. |
| `archive_message` | Archive a message: keeps it for reference, out of the way. |
| `delete_message` | Delete a message. Permanent. |

Addresses outside the configured domain are rejected locally, before any
storage access; mail to unknown or disabled addresses on the domain is
bounced by the Worker.

## Agent guidance

The server tells connecting agents what it is for and how to behave with it.
The initialize response carries instructions: mailbox-mcp is for temporary
addresses that receive mail (sign-up flows, sign-in with email, account
creation on systems under test), it **cannot send email**, and archiving
no-longer-needed mail is preferred over deleting it. It also offers three
prompts — `temporary-email`, `verification-code`, and `mailbox-summary` —
that walk an agent through those flows. The wording is reviewed in
[issue #39](https://github.com/st3fan/mailbox-mcp/issues/39).

## Configuration

The Worker is configured with wrangler vars, secrets, and bindings. Only
two of them need your attention — the rest have sensible defaults:

| Binding | Kind | Required | Meaning |
|---|---|---|---|
| `MAILBOX_MCP_DOMAIN` | var | **Yes** | The single (dedicated) email domain to manage, e.g. `example.com`. |
| `MAILBOX_MCP_BEARER_TOKEN` | secret | **Yes** | Bearer token MCP clients must present at `/mcp`. Generate a random string, e.g. `openssl rand -hex 32`. |
| `MAILBOX_MCP_STORE` | R2 binding | No | The bucket received mail is stored in. Has a default: it is provisioned automatically as `mailbox-mcp-store` (the button creates it; CLI: `wrangler r2 bucket create mailbox-mcp-store`). Only change this if you want a custom bucket name. |
| `MAILBOX_MCP_REGISTRY` | D1 binding | No | The mailbox registry. Has a default: it is provisioned automatically as `mailbox-mcp-registry`, with the schema applied by the deploy script. Only change this if you want a custom database name. |

**No Cloudflare API token is needed**: mailboxes are
registry entries, and the catch-all routing rule is configured once, by
hand, in the dashboard.

## Install

### One-click install (Deploy to Cloudflare)

Click the button, connect your GitHub account, pick your dedicated email
domain (`MAILBOX_MCP_DOMAIN`) and a bearer token (`MAILBOX_MCP_BEARER_TOKEN` — generate a random
string, e.g. `openssl rand -hex 32`): the R2 bucket and D1 registry are
provisioned automatically, the registry schema is applied by the deploy
script, and the Worker is deployed. The repo is cloned into your GitHub
account, so **updates deploy automatically** when you push to your clone.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/st3fan/mailbox-mcp/tree/main/workers/mcp)

After deploying, two one-time manual steps remain:

1. **Enable Email Routing** on your dedicated domain (dashboard → Email →
   Email Routing → enable).
2. **Configure the catch-all rule**: Email Routing → Routing Rules →
   Catch-all address → Edit → action **Send to a Worker** → select the
   deployed `mailbox-mcp` Worker.

Then connect your MCP client (see [Using from an MCP client](#using-from-an-mcp-client)).

### CLI install

```sh
npx wrangler r2 bucket create mailbox-mcp-store   # once
npx wrangler d1 create mailbox-mcp-registry                   # once; paste the ID
                                                          # into workers/mcp/wrangler.toml

cd workers/mcp
npm install
npx wrangler secret put MAILBOX_MCP_BEARER_TOKEN
npm run deploy                                            # applies migrations, then deploys
```

The consolidated Worker includes mail ingestion — after deploying, the
catch-all rule must point at the `mailbox-mcp` Worker (see the one-click
checklist above).

**Security note:** `/mcp` is protected only by the bearer token. Keep
`MAILBOX_MCP_BEARER_TOKEN` private; anyone holding it can manage mailboxes and read
stored mail.

## Update

- **Deploy-button installs** come with Cloudflare's git integration: every
  push to your clone deploys automatically. To update, sync your clone with
  upstream (GitHub: *Sync fork* → *Update branch*) and the new version
  deploys itself, applying any new D1 migrations via the deploy script.
- **CLI installs**: `git pull && npm install && npm run deploy` from
  `workers/mcp` — the deploy script applies pending migrations (safe to
  re-run; migrations are append-only).
- **Rollback**: deploy an older commit (`git checkout v0.4.0 && npm run
  deploy`), or use the dashboard (Workers → mailbox-mcp → Deployments →
  Rollback).

## Remove

Order matters: stop mail delivery first, then remove the Worker, then the
resources. **Deleting the Worker does not delete the D1 database or the R2
bucket** — remove those explicitly, or your stored mail stays behind:

1. Remove the catch-all rule (dashboard: Email Routing → Routing Rules →
   Catch-all address → set to drop, or disable Email Routing for the
   domain). Without this, mail to the domain bounces once the Worker is
   gone.
2. Remove the Worker and the resources (permanent — this deletes the
   registry and **all stored mail**):

   ```sh
   cd workers/mcp && npm run uninstall
   ```

   which runs, with a confirmation prompt for each:
   `npx wrangler delete`, `npx wrangler d1 delete mailbox-mcp-registry`, and
   `npx wrangler r2 bucket delete mailbox-mcp-store`.

## Using from an MCP client

Add the server as a remote MCP server, e.g. in Cline's MCP settings or any
client that supports remote servers:

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

## Development

The Worker is a TypeScript project with vitest tests and `tsc` type
checking:

```sh
cd workers/mcp && npm install && npm test && npm run typecheck
```

See [DEVELOPING.md](DEVELOPING.md) for the full runbook and
[AGENTS.md](AGENTS.md) for how work is planned and landed in this
repository.