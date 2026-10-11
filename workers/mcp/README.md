# mailbox-mcp MCP worker

Serves the mailbox-mcp MCP endpoint as streamable HTTP at `/mcp` (bearer
token auth), owns the **mailbox registry** (a D1 database shared with the
[email worker](../email-worker)) and the message storage in the
`MAILBOX_STORE` R2 binding. Mailboxes are registry entries, not Email
Routing rules: a single catch-all rule routes the domain's mail to the email
worker, which accepts registered, enabled addresses.

## Configuration

wrangler vars: `DOMAIN`. Secrets: `MCP_AUTH_TOKEN` (bearer token clients
must present). Bindings: `MAILBOX_STORE` (R2) and `REGISTRY` (D1). Create
the D1 database once and paste its ID into both workers' wrangler.toml:

```sh
npx wrangler d1 create mailbox-registry
npx wrangler d1 migrations apply mailbox-registry
```

Deployment steps are in the repository root
[DEVELOPING.md](../../DEVELOPING.md).

## Layout

- `src/index.ts` — the Worker `fetch` handler: bearer auth, `/mcp` routing.
- `src/server.ts` — the MCP server: instructions, prompts, tool registration.
- `src/message-tools.ts` — the five message tools (direct R2 access).
- `src/mailbox-tools.ts` — the six mailbox tools (registry CRUD).
- `src/registry.ts` — the mailbox registry operations (D1).
- `src/storage.ts` — R2 message storage (list/read/patch/delete).
- `src/guidance.ts` — instructions and prompt texts.

## Development

```sh
npm install
npm test
npm run typecheck
npm run deploy
```