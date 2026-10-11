# mailbox-mcp MCP worker

Serves the mailbox-mcp MCP endpoint as streamable HTTP at `/mcp` (bearer
token auth) and owns message storage in the `MAILBOX_STORE` R2 binding,
which it shares with the [email worker](../email-worker). Mailbox management
goes through Cloudflare's Email Routing API with the `CLOUDFLARE_API_TOKEN`
secret.

## Configuration

wrangler vars: `DOMAIN`, `EMAIL_WORKER`. Secrets:
`CLOUDFLARE_API_TOKEN` (Email Routing Rules Edit token for the domain),
`MCP_AUTH_TOKEN` (bearer token clients must present). Set secrets with
`wrangler secret put <NAME>`; deployment steps are in the repository root
[DEVELOPING.md](../../DEVELOPING.md).

## Layout

- `src/index.ts` — the Worker `fetch` handler: bearer auth, `/mcp` routing.
- `src/server.ts` — the MCP server: instructions, prompts, tool registration.
- `src/message-tools.ts` — the five message tools (direct R2 access).
- `src/mailbox-tools.ts` — the six mailbox tools (Email Routing API).
- `src/cloudflare.ts` — the Email Routing API client.
- `src/storage.ts` — R2 message storage (list/read/patch/delete).
- `src/guidance.ts` — instructions and prompt texts.

## Development

```sh
npm install
npm test
npm run typecheck
npm run deploy
```