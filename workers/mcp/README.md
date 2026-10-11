# mailbox-mcp MCP worker

The single mailbox-mcp Worker: it serves the MCP endpoint as streamable HTTP
at `/mcp` (bearer token auth) **and** ingests mail — the `email()` handler
accepts registered, enabled mailboxes routed by the catch-all Email Routing
rule and stores them in R2. It owns the **mailbox registry** (a D1 database)
and the `MAILBOX_STORE` R2 binding for message storage.

## Configuration

wrangler vars: `DOMAIN`. Secrets: `MCP_AUTH_TOKEN` (bearer token clients
must present). Bindings: `MAILBOX_STORE` (R2) and `REGISTRY` (D1). Create
the D1 database once and apply the schema:

```sh
npx wrangler d1 create mailbox-registry
npx wrangler d1 migrations apply mailbox-registry
```

Deployment steps are in the repository root
[DEVELOPING.md](../../DEVELOPING.md).

## Layout

- `src/index.ts` — the Worker handlers: `fetch` (bearer auth, `/mcp`
  routing) and `email` (acceptance check + mail storage).
- `src/server.ts` — the MCP server: instructions, prompts, tool registration.
- `src/message-tools.ts` — the five message tools (direct R2 access).
- `src/mailbox-tools.ts` — the six mailbox tools (registry CRUD).
- `src/registry.ts` — the mailbox registry operations (D1), including
  `deleteAllMessages` (used by delete_mailbox) and the read-side lookup used
  by the email handler.
- `src/storage.ts` — R2 message storage (list/read/patch/delete).
- `src/guidance.ts` — instructions and prompt texts.
- `src/keys.ts`, `src/metadata.ts` — mail storage key building and metadata.

## Development

```sh
npm install
npm test
npm run typecheck
npm run deploy
```