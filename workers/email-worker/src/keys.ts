// Key building for messages stored in R2 by the email worker.
//
// Layout in the bucket:
//
//   <mailbox>/<receivedAtMillis>-<messageId>.eml    raw message
//   <mailbox>/<receivedAtMillis>-<messageId>.json   metadata
//
// The stem `<receivedAtMillis>-<messageId>` is the message id used by the
// messages API: sorting keys with a plain string sort sorts a mailbox's
// messages oldest first, newest last, and the messages API lists the metadata
// objects (".json") newest first by reversing that order.

/** Characters that are unsafe or awkward in an R2 key; everything else is
 * replaced with "-" when building the id part of a key. The id is a single
 * path segment below the mailbox prefix, so "/" is never allowed to survive.
 * "@" stays, so ids keep the shape of real Message-IDs and remain valid in
 * API URL paths. */
const KEY_UNSAFE = /[^A-Za-z0-9._@-]/g;

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
  /** The message id used in API paths: `<receivedAtMillis>-<slug>` or
   * `<receivedAtMillis>-<random>` when the message has no usable Message-ID. */
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
  const id = `${receivedAtMillis}-${slug}`;
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