// Mailbox registry lookup for the email worker: the worker only accepts mail
// for addresses registered and enabled in the shared D1 registry. The MCP
// worker manages the registry; this worker only reads it.

export interface Mailbox {
  address: string;
  enabled: boolean;
  created_at: string;
}

function toMailboxShim(row: { address: string; enabled: number; created_at: string }): Mailbox {
  return { address: row.address, enabled: row.enabled === 1, created_at: row.created_at };
}

/** getMailbox returns one registry entry, or null when the address is not
 * registered. */
export async function getMailbox(db: D1Database, address: string): Promise<Mailbox | null> {
  const row = await db
    .prepare("SELECT address, enabled, created_at FROM mailboxes WHERE address = ?")
    .bind(address)
    .first<{ address: string; enabled: number; created_at: string }>();
  return row === null ? null : toMailboxShim(row);
}