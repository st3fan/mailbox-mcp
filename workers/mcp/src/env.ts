// Worker bindings and configuration for the mailbox-mcp MCP worker.

export interface Env {
  /** R2 bucket the email worker stores messages in; owned by this worker. */
  MAILBOX_STORE: R2Bucket;

  /** The single email domain mailboxes are managed on (wrangler var). */
  DOMAIN: string;

  /** Name of the Email Worker that mailbox routing rules point to (wrangler var). */
  EMAIL_WORKER: string;

  /** Cloudflare API token with Email Routing Rules edit permission for DOMAIN (secret). */
  CLOUDFLARE_API_TOKEN: string;

  /** Bearer token MCP clients must present (secret). */
  MCP_AUTH_TOKEN: string;
}