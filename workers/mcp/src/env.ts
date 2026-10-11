// Worker bindings and configuration for the mailbox-mcp MCP worker.

export interface Env {
  /** R2 bucket the email worker stores messages in; owned by this worker. */
  MAILBOX_MCP_STORE: R2Bucket;

  /** D1 database holding the mailbox registry (shared with the email worker). */
  MAILBOX_MCP_REGISTRY: D1Database;

  /** The single email domain mailboxes are managed on (wrangler var). */
  MAILBOX_MCP_DOMAIN: string;

  /** Bearer token MCP clients must present (secret). */
  MAILBOX_MCP_BEARER_TOKEN: string;
}