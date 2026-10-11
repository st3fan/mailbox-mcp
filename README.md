# mailbox-mcp

mailbox-mcp is an MCP server that sits on top of Cloudflare's Email Routing
functionality. With a domain that is onboarded to that service, it can create,
list, and delete **mailboxes** — an MCP term here meaning an email address whose
mail is routed by an Email Routing rule to the `mailbox-mcp-email-worker` Email
Worker, which stores the email in R2.

The project is about **creating temporary email addresses, receiving email, and
managing the mailbox**. It deliberately has no functionality to send email. See
[PRODUCT.md](PRODUCT.md) for the full product scope.

## Tools

| Tool | Description |
|---|---|
| `create_mailbox` | Create a mailbox: an Email Routing rule routing the address to the Email Worker. |
| `create_random_mailbox` | Create a mailbox with a generated address like `john.smith@domain`. |
| `list_mailboxes` | List mailboxes managed by mailbox-mcp on the configured domain. |
| `delete_mailbox` | Delete a mailbox by address. |
| `enable_mailbox` | Re-activate a mailbox: mail to the address is routed again. |
| `disable_mailbox` | De-activate a mailbox: it keeps existing but mail is no longer routed. |
| `list_messages` | List a mailbox's messages, newest first, paginated. |
| `read_message` | Read one message: metadata and raw content. |
| `mark_message_read` | Mark a message as read. |
| `archive_message` | Archive a message. |
| `delete_message` | Delete a message. |

Addresses outside the configured domain are rejected locally, before any API
call. Other routing rules that may exist on the domain (forwarding rules,
catch-alls) are never listed or deleted.

## Configuration

The server is configured through environment variables and fails fast at
startup if anything is missing or invalid. Variables that are not set in the
environment are filled from a `.env` file in the working directory, if present:
`KEY=VALUE` lines, `#` comments and blank lines ignored, optional surrounding
quotes on values. The environment always wins over `.env`, and a missing
`.env` is not an error.

| Variable | Required | Default | Description |
|---|---|---|---|
| `MAILBOX_MCP_CLOUDFLARE_API_TOKEN` | yes | — | Cloudflare API token with **Zone → Email Routing Rules → Edit** permission for the domain's zone. |
| `MAILBOX_MCP_DOMAIN` | yes | — | The single email domain to manage, e.g. `mail.example.com`. |
| `MAILBOX_MCP_EMAIL_WORKER` | no | `mailbox-mcp-email-worker` | Name of the Email Worker that mailboxes route to. |
| `MAILBOX_MCP_TRANSPORT` | no | `stdio` | MCP transport. Only `stdio` is supported. |
| `MAILBOX_MCP_MESSAGES_API_URL` | yes | — | Base URL of the messages API worker that serves stored mail. |
| `MAILBOX_MCP_MESSAGES_API_TOKEN` | yes | — | Bearer token of the messages API worker. |

Create a scoped API token in the Cloudflare dashboard: **My Profile → API
Tokens → Create Token**, with the *Email Routing Rules* edit permission scoped
to the zone of your email domain.

Mail storage and reading run on two Cloudflare Workers in [`workers/`](workers/):
the Email Worker that stores mail in R2
([setup](workers/email-worker/README.md)) and the messages API that serves it
([setup](workers/messages-api/README.md), including the API token and base URL
the two `MAILBOX_MCP_MESSAGES_API_*` variables expect).

## Running locally

```sh
export MAILBOX_MCP_CLOUDFLARE_API_TOKEN=...
export MAILBOX_MCP_DOMAIN=mail.example.com
go run ./cmd/mailbox-mcp
```

## Running with Docker

```sh
docker build -t mailbox-mcp .
docker run -i --rm \
  -e MAILBOX_MCP_CLOUDFLARE_API_TOKEN=... \
  -e MAILBOX_MCP_DOMAIN=mail.example.com \
  mailbox-mcp
```

## Using from an MCP client

Add the server to your MCP client configuration, for example:

```json
{
  "mcpServers": {
    "mailbox-mcp": {
      "command": "docker",
      "args": ["run", "-i", "--rm",
        "-e", "MAILBOX_MCP_CLOUDFLARE_API_TOKEN",
        "-e", "MAILBOX_MCP_DOMAIN=mail.example.com"],
      "env": { "MAILBOX_MCP_CLOUDFLARE_API_TOKEN": "..." }
    }
  }
}
```

## Development

```sh
go build ./...
go test ./...
go vet ./...
```

See [AGENTS.md](AGENTS.md) for how work is planned and landed in this
repository.