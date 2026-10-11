// Key building for messages stored in R2 by the email worker.
//
// Layout in the bucket:
//
//   <mailbox>/<sortKey>-<messageId>.eml     raw message
//   <mailbox>/<sortKey>-<messageId>.json    metadata
//
// The stem `<sortKey>-<messageId>` is the message id used by the messages API.
// `<sortKey>` is the receive time inverted against a fixed maximum
// (9999999999999 - receivedAtMillis, zero-padded to 13 digits), so sorting keys
// with a plain string sort sorts a mailbox's messages NEWEST FIRST. That lets
// the messages API list forward with R2's ascending prefix listing and page
// correctly. The real receive time stays visible in metadata.receivedAt.

/** Characters that are unsafe or awkward in an R2 key; everything else is
 * replaced with "-" when building the id part of a key. The id is a single
 * path segment below the mailbox prefix, so "/" is never allowed to survive.
 * "@" stays, so ids keep the shape of real Message-IDs and remain valid in
 * API URL paths. */
const KEY_UNSAFE = /[^A-Za-z0-9._@-]/g;

/** Fixed maximum epoch millis the sort key inverts against. Covers 13-digit
 * timestamps (until year 2286); after that the ordering degrades gracefully. */
const MAX_MILLIS = 9999999999999;

/** Encodes receive time so ascending string order equals newest first. */
export function sortKeyFor(receivedAtMillis: number): string {
  return String(MAX_MILLIS - receivedAtMillis).padStart(13, "0");
}

/** Removes the angle brackets of a Message-ID header value ("<...>") and any
 * surrounding whitespace. Returns null for empty input. */
export function unwrapMessageId(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const unwrapped = value.trim().replace(/^<+/, "").replace(/>+$/, "").trim();
  return unwrapped === "" ? null : unwrapped;
}

/** Turns a Message-ID into the id part of a key: safe characters only, no
 * slashes, empty ids rejected. Returns null when there is nothing usable. */
export function keyIdFromMessageId(value: string | null | undefined): string | null {
  const unwrapped = unwrapMessageId(value);
  if (unwrapped === null) {
    return null;
  }
  const slug = unwrapped.replace(KEY_UNSAFE, "-");
  return slug === "" ? null : slug;
}

export interface MessageKey {
  /** The message id used in API paths: `<sortKey>-<slug>` or
   * `<sortKey>-<random>` when the message has no usable Message-ID. */
  id: string;
  /** Key of the raw message object. */
  raw: string;
  /** Key of the metadata object. */
  metadata: string;
}

/** Builds the R2 keys for a message received for `mailbox` at
 * `receivedAtMillis`. When the message has no usable Message-ID, a random slug
 * is generated so two messages can never collide on one key. */
export function buildMessageKeys(
  mailbox: string,
  receivedAtMillis: number,
  messageId: string | null | undefined,
): MessageKey {
  const slug = keyIdFromMessageId(messageId) ?? randomSlug();
  const id = `${sortKeyFor(receivedAtMillis)}-${slug}`;
  return {
    id,
    raw: `${mailbox}/${id}.eml`,
    metadata: `${mailbox}/${id}.json`,
  };
}

function randomSlug(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}