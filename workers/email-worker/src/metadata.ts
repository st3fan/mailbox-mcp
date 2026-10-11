// Per-message metadata stored alongside the raw message. This is what the
// messages API lists and what carries the read/archived flags; the raw message
// is only fetched when an individual message is read.

export interface MessageMetadata {
  /** The message id used in API paths, equal to the key stem: `<receivedAtMillis>-<slug>`. */
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

export interface NewMetadataInput {
  id: string;
  from: string;
  to: string;
  subject: string | null | undefined;
  receivedAtMillis: number;
  size: number;
}

/** Builds the initial metadata for a freshly stored message: unread, not archived. */
export function newMetadata(input: NewMetadataInput): MessageMetadata {
  const mailbox = input.to.trim().toLowerCase();
  return {
    id: input.id,
    mailbox,
    from: input.from,
    to: mailbox,
    subject: input.subject?.trim() ?? "",
    receivedAt: new Date(input.receivedAtMillis).toISOString(),
    size: input.size,
    read: false,
    archived: false,
  };
}