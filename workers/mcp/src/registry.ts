// Mailbox registry operations on D1. Ported from the Email Routing rule
// management the Go/Email-Routing-API era provided: create, list, get,
// enable/disable, delete — now as registry rows in a strongly-consistent
// SQLite database, so a freshly created mailbox is immediately known to the
// email worker (no routing-rule activation delay).

export interface Mailbox {
  address: string;
  enabled: boolean;
  created_at: string;
}

/** RegistryConflictError is thrown when creating a mailbox whose address
 * already exists. create_random_mailbox catches it and retries with a new
 * generated name. */
export class RegistryConflictError extends Error {
  readonly address: string;

  constructor(address: string) {
    super(`mailbox "${address}" already exists`);
    this.address = address;
    this.name = "RegistryConflictError";
  }
}

function toMailbox(row: { address: string; enabled: number | boolean; created_at: string }): Mailbox {
  return { address: row.address, enabled: row.enabled === 1 || row.enabled === true, created_at: row.created_at };
}

/** createMailbox inserts a new enabled mailbox. Throws RegistryConflictError
 * when the address already exists (the registry's PRIMARY KEY). */
export async function createMailbox(db: D1Database, address: string): Promise<Mailbox> {
  const created_at = new Date().toISOString();
  try {
    await db
      .prepare("INSERT INTO mailboxes (address, enabled, created_at) VALUES (?, 1, ?)")
      .bind(address, created_at)
      .run();
  } catch (err) {
    if (String(err).includes("UNIQUE constraint failed")) {
      throw new RegistryConflictError(address);
    }
    throw err;
  }
  return { address, enabled: true, created_at };
}

/** listMailboxes returns all registry entries, sorted by address. */
export async function listMailboxes(db: D1Database): Promise<Mailbox[]> {
  const res = await db
    .prepare("SELECT address, enabled, created_at FROM mailboxes ORDER BY address")
    .all<{ address: string; enabled: number; created_at: string }>();
  return res.results.map(toMailbox);
}

/** getMailbox returns one registry entry, or null when it does not exist. */
export async function getMailbox(db: D1Database, address: string): Promise<Mailbox | null> {
  const row = await db
    .prepare("SELECT address, enabled, created_at FROM mailboxes WHERE address = ?")
    .bind(address)
    .first<{ address: string; enabled: number; created_at: string }>();
  return row === null ? null : toMailbox(row);
}

/** setMailboxEnabled flips the enabled flag. Throws when the mailbox does not
 * exist. */
export async function setMailboxEnabled(db: D1Database, address: string, enabled: boolean): Promise<Mailbox> {
  const res = await db
    .prepare("UPDATE mailboxes SET enabled = ? WHERE address = ?")
    .bind(enabled ? 1 : 0, address)
    .run();
  if ((res.meta?.changes ?? 0) === 0) {
    throw new Error(`mailbox "${address}" not found`);
  }
  return (await getMailbox(db, address))!;
}

/** deleteMailboxStorage permanently deletes every stored message of a
 * mailbox: all `.eml` and `.json` objects under its prefix, across all R2
 * list pages. */
export async function deleteAllMessages(bucket: R2Bucket, mailbox: string): Promise<number> {
  const prefix = `${mailbox}/`;
  let deleted = 0;
  let cursor: string | undefined;
  // Bound the internal paging so a huge mailbox cannot make one request run
  // unbounded; callers can simply call again to continue.
  for (let pages = 0; pages < 100; pages++) {
    const page: R2Objects = await bucket.list({ prefix, cursor, limit: 1000 });
    const keys = page.objects.map((o) => o.key);
    if (keys.length > 0) {
      await bucket.delete(keys);
      deleted += keys.length;
    }
    if (!page.truncated) {
      return deleted;
    }
    cursor = page.cursor;
  }
  return deleted;
}

/** deleteMailbox removes the registry entry. Throws when the mailbox does not
 * exist. The delete_mailbox tool also purges the mailbox's stored R2
 * messages on top of this. */
export async function deleteMailbox(db: D1Database, address: string): Promise<void> {
  const res = await db.prepare("DELETE FROM mailboxes WHERE address = ?").bind(address).run();
  if ((res.meta?.changes ?? 0) === 0) {
    throw new Error(`mailbox "${address}" not found`);
  }
}