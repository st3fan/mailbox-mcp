// R2-backed message storage owned by the MCP worker.
//
// Message layout is defined by the email worker (see ../email-worker): under
// the recipient mailbox's prefix, `<id>.eml` is the raw message and `<id>.json`
// its metadata. This module lists metadata objects, reads raw + metadata, and
// rewrites metadata for flag changes. Ported from the retired messages API
// worker: tools use it directly, there is no separate messages API anymore.

export interface MessageMetadata {
  /** The message id used in API paths: `<receivedAtMillis>-<slug>`. */
  id: string;
  /** Mailbox address the message was sent to, lowercased. */
  mailbox: string;
  /** Envelope sender address. */
  from: string;
  /** Envelope recipient address, lowercased, equal to `mailbox`. */
  to: string;
  /** Subject header value, empty string when absent. */
  subject: string;
  /** Receive time as an RFC 3339 UTC timestamp. */
  receivedAt: string;
  /** Size of the raw message in bytes. */
  size: number;
  /** Whether the message has been marked read. */
  read: boolean;
  /** Whether the message has been archived. */
  archived: boolean;
}

/** Mailbox addresses are local@domain with no slashes or whitespace, so they
 * can safely be a single R2 key prefix and a single URL path segment. */
const MAILBOX_RE = /^[^@\s/]+@[^@\s/]+$/;

/** Message ids are the email worker's key stems: a 13-digit inverted receive
 * time, then the sanitized Message-ID (or random slug). They therefore start
 * with a digit; restricting to these characters makes them safe as R2 key
 * parts and URL path segments, and rejects "." and "..". */
const ID_RE = /^[0-9][A-Za-z0-9._@-]*$/;

/** Normalizes a mailbox path parameter; null when it is not a usable mailbox
 * address. */
export function normalizeMailbox(input: string): string | null {
  const mailbox = input.trim().toLowerCase();
  if (!MAILBOX_RE.test(mailbox) || mailbox.length > 254) {
    return null;
  }
  return mailbox;
}

/** Whether a message id path parameter is in the safe shape. */
export function isValidMessageId(id: string): boolean {
  return ID_RE.test(id) && id.length <= 512;
}

export function rawKey(mailbox: string, id: string): string {
  return `${mailbox}/${id}.eml`;
}

export function metadataKey(mailbox: string, id: string): string {
  return `${mailbox}/${id}.json`;
}

function isMessageMetadata(value: unknown): value is MessageMetadata {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.mailbox === "string" &&
    typeof v.from === "string" &&
    typeof v.to === "string" &&
    typeof v.subject === "string" &&
    typeof v.receivedAt === "string" &&
    typeof v.size === "number" &&
    typeof v.read === "boolean" &&
    typeof v.archived === "boolean"
  );
}

export interface MetadataPage {
  /** Newest-first page of metadata. */
  messages: MessageMetadata[];
  /** Opaque page token to resume listing after this page; null when the
   * mailbox is exhausted. */
  nextCursor: string | null;
}

/** Page tokens that resume at an R2 page boundary (as opposed to mid-page,
 * which uses the last consumed key with startAfter). */
const CURSOR_TOKEN_PREFIX = "cursor:";

/** Lists a mailbox's messages newest first.
 *
 * The email worker builds message ids with an inverted receive time, so
 * ascending key order IS newest first: listing walks R2's ascending prefix
 * listing forward and stops after `limit` metadata objects. The token to
 * resume with is the last key consumed (a plain key, resumed with startAfter),
 * or a CURSOR_TOKEN_PREFIX-prefixed R2 cursor when a page boundary was
 * reached. The internal page loop keeps going until `limit` metadata objects
 * are collected or the prefix is exhausted, so short R2 pages do not produce
 * short API pages. */
export async function listMetadata(
  bucket: R2Bucket,
  mailbox: string,
  pageToken: string | undefined,
  limit: number,
): Promise<MetadataPage> {
  const messages: MessageMetadata[] = [];
  let current = pageToken;
  // Bound the internal paging so a huge mailbox cannot make one request run
  // unbounded; the returned token lets the client keep going.
  for (let pages = 0; pages < 20; pages++) {
    const options: R2ListOptions = { prefix: `${mailbox}/`, limit: 1000 };
    if (current !== undefined) {
      if (current.startsWith(CURSOR_TOKEN_PREFIX)) {
        options.cursor = current.slice(CURSOR_TOKEN_PREFIX.length);
      } else {
        options.startAfter = current;
      }
    }
    const page: R2Objects = await bucket.list(options);
    const keys = page.objects.map((o) => o.key);
    let lastIndex = -1;
    for (let i = 0; i < keys.length && messages.length < limit; i++) {
      lastIndex = i;
      const key = keys[i]!;
      if (!key.endsWith(".json")) {
        continue;
      }
      const stored = await bucket.get(key);
      if (stored === null) {
        continue;
      }
      const meta = await stored.json<MessageMetadata>();
      if (isMessageMetadata(meta)) {
        messages.push(meta);
      }
    }
    if (messages.length >= limit) {
      // Stopped mid-page (or at its very end): resume with startAfter the
      // last key consumed, so nothing is skipped or returned twice.
      return { messages, nextCursor: keys[lastIndex]! };
    }
    if (!page.truncated) {
      return { messages, nextCursor: null };
    }
    current = CURSOR_TOKEN_PREFIX + page.cursor;
  }
  return { messages, nextCursor: current ?? null };
}

/** Reads one message's metadata; null when the metadata object does not exist
 * or does not hold valid metadata. */
export async function getMetadata(
  bucket: R2Bucket,
  mailbox: string,
  id: string,
): Promise<MessageMetadata | null> {
  const stored = await bucket.get(metadataKey(mailbox, id));
  if (stored === null) {
    return null;
  }
  const meta = await stored.json<MessageMetadata>();
  return isMessageMetadata(meta) ? meta : null;
}

/** Reads one message's raw content as text; null when it does not exist. */
export async function getRaw(
  bucket: R2Bucket,
  mailbox: string,
  id: string,
): Promise<string | null> {
  const stored = await bucket.get(rawKey(mailbox, id));
  return stored === null ? null : stored.text();
}

export interface MetadataPatch {
  read?: boolean;
  archived?: boolean;
}

/** Rewrites a message's metadata with the given flags applied. The caller must
 * have verified the metadata exists (with getMetadata) right before calling. */
export async function patchMetadata(
  bucket: R2Bucket,
  metadata: MessageMetadata,
  patch: MetadataPatch,
): Promise<MessageMetadata> {
  const updated: MessageMetadata = {
    ...metadata,
    read: patch.read ?? metadata.read,
    archived: patch.archived ?? metadata.archived,
  };
  await bucket.put(metadataKey(updated.mailbox, updated.id), JSON.stringify(updated), {
    httpMetadata: { contentType: "application/json" },
  });
  return updated;
}

/** Deletes a message's raw and metadata objects. */
export async function deleteMessage(bucket: R2Bucket, mailbox: string, id: string): Promise<void> {
  await bucket.delete([rawKey(mailbox, id), metadataKey(mailbox, id)]);
}