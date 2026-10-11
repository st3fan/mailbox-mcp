# mailbox-mcp

mailbox-mcp is an MCP server for **temporary email addresses that actually
receive mail**, running entirely on Cloudflare. With a domain onboarded to
Cloudflare Email Routing, it creates and manages mailboxes — addresses whose
mail is routed by an Email Routing rule to an Email Worker and stored in R2 —
and lets agents read and manage the mail they receive.

The project is about **creating temporary email addresses, receiving email,
and managing the mailbox**. It deliberately has no functionality to send
email.

## Architecture

Everything runs on Cloudflare as two Workers with different responsibilities:

1. **`workers/email-worker`** (`mailbox-mcp-email-worker`) — receives mail
   routed by Email Routing rules and stores it in R2.
2. **`workers/mcp`** (`mailbox-mcp`) — serves the MCP endpoint as streamable
   HTTP at `/mcp` (bearer-token auth), owns message storage (direct R2
   access), and manages mailboxes by talking to Cloudflare's Email Routing
   API with a scoped token.

Agents connect to `https://mailbox-mcp.<account>.workers.dev/mcp` as a
remote MCP server.

## Tools

| Tool | Description |
|---|---|
| `create_mailbox` | Create a mailbox: an Email Routing rule routing the address to the Email Worker. |
| `create_random_mailbox` | Create a mailbox with a generated address like `john.smith@domain`. |
| `list_mailboxes` | List mailboxes managed by mailbox-mcp on the configured domain. |
| `delete_mailbox` | Delete a mailbox by address. Permanent. |
| `enable_mailbox` | Re-activate a mailbox: mail to the address is routed again. |
| `disable_mailbox` | De-activate a mailbox: it keeps existing but mail is no longer routed. |
| `list_messages` | List a mailbox's messages, newest first, paginated. Never marks messages read. |
| `read_message` | Read one message: metadata and raw content. Marks the message as read automatically. |
| `mark_message_read` | Mark a message as read without re-reading it. |
| `archive_message` | Archive a message: keeps it for reference, out of the way. |
| `delete_message` | Delete a message. Permanent. |

Addresses outside the configured domain are rejected locally, before any
storage or API access. Other routing rules that may exist on the domain
(forwarding rules, catch-alls) are never listed or deleted.

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

The MCP worker is configured with wrangler vars and secrets:

| Binding | Kind | Meaning |
|---|---|---|
| `DOMAIN` | var | The single email domain to manage, e.g. `outofscope.party`. |
| `EMAIL_WORKER` | var | Name of the Email Worker mailboxes route to. |
| `MAILBOX_STORE` | R2 binding | The bucket the email worker stores mail in. |
| `CLOUDFLARE_API_TOKEN` | secret | API token with **Zone → Email Routing Rules → Edit** permission for the domain's zone. |
| `MCP_AUTH_TOKEN` | secret | Bearer token MCP clients must present at `/mcp`. |

## Deploying

```sh
cd workers/mcp
npm install
npx wrangler secret put CLOUDFLARE_API_TOKEN
npx wrangler secret put MCP_AUTH_TOKEN
npm run deploy
```

The Email Worker deploys the same way from `workers/email-worker` (see its
README for the R2 bucket setup).

**Security note:** `/mcp` is protected only by the bearer token. Keep
`MCP_AUTH_TOKEN` private; anyone holding it can manage mailboxes and read
stored mail.

## Using from an MCP client

Add the server as a remote MCP server, e.g. in Cline's MCP settings or any
client that supports remote servers:

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

## Development

Each worker is its own TypeScript project with vitest tests and `tsc` type
checking:

```sh
cd workers/mcp && npm install && npm test && npm run typecheck
cd workers/email-worker && npm install && npm test && npm run typecheck
```

See [DEVELOPING.md](DEVELOPING.md) for the full runbook and
[AGENTS.md](AGENTS.md) for how work is planned and landed in this
repository.