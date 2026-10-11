// Guidance mailbox-mcp advertises to agents: the server instructions sent to
// clients in the initialize response and the prompt templates agents can
// fetch. Ported from the Go internal/guidance package (issue #39 drafts, as
// amended: reading marks read, cannot send email, archive over delete).

export const INSTRUCTIONS = `You are connected to mailbox-mcp, an MCP server for temporary email addresses that actually receive mail. Typical uses: testing sign-up flows, sign-in with email (magic link or code) flows, and creating accounts on systems being tested by agents.

This server cannot send email. There is no sending, replying, forwarding, or editing of mail — mailboxes only receive. If a task needs mail to be sent, that has to happen outside this server.

- create_random_mailbox gives you a fresh address like first.last@<domain>. Use it whenever a form, signup, or service needs an email address.
- Mail sent to a mailbox is stored automatically; you do not need to fetch anything. Check a mailbox with list_messages — safe to poll, listing never marks messages read. Read a message in full with read_message — it marks the message as read automatically. To mark a message handled without re-reading it, use mark_message_read.
- Prefer archiving over deleting. When a message is no longer needed, use archive_message: it keeps the mail for later reference while removing it from the way. delete_message destroys a message permanently and cannot be undone — reserve it for noise you are certain about (bouncebacks, obvious spam).
- delete_mailbox removes the mailbox and all its mail permanently. Only delete a mailbox when the address is truly finished with and nothing in it is worth keeping — when in doubt, leave it.
- Addresses must be on the configured domain; anything else is rejected locally before any API call.`;

/** Builds the temporary-email prompt text for the given purpose. */
export function temporaryEmailPrompt(purpose: string): string {
  const stated = purpose.trim() === "" ? "(not stated — infer it from the task at hand)" : purpose.trim();
  return `Create a temporary email address with create_random_mailbox.
Purpose: ${stated}.

Remember: mailbox-mcp cannot send email — the address only receives.

1. Use the new address wherever an email address is asked for.
2. After submitting, wait a moment, then poll list_messages for that address (polling is side-effect free).
3. When mail arrives, read_message the newest one — reading marks it as read automatically — and extract whatever the purpose needs (link, code, confirmation).
4. If the message is no longer needed, archive_message it — prefer archiving over deleting so it stays available for reference. Only delete_message mail you are certain is disposable noise.
5. Keep the mailbox for now; only delete_mailbox when the address is truly done with and nothing in it is worth keeping.`;
}

/** Builds the verification-code prompt text for the given site. */
export function verificationCodePrompt(site: string): string {
  const target = site.trim() === "" ? "the target site" : site.trim();
  return `You are completing an email verification flow for ${target} — receiving only: the site sends the mail, you read it here.

1. Create a fresh address with create_random_mailbox and use it on the site's form.
2. Poll list_messages for that address a few times over the next minute (listing does not mark anything read).
3. When the verification email appears, read_message the newest message and extract the verification link or code.
4. Report the link or code to me — reading the message above already marked it as read.
5. Finish by archiving it with archive_message — archive rather than delete, so the proof of verification stays around in case it is needed again.`;
}

/** Builds the mailbox-summary prompt text for the given address. */
export function mailboxSummaryPrompt(address: string): string {
  return `Summarize the mailbox ${address}:

1. list_messages the address and summarize each message: subject, sender, when it arrived, and what it appears to be about.
2. Note which messages are unread.
3. For messages whose content is fully handled, mark_message_read them.
4. Suggest which messages could be archived as no-longer-needed — but do not archive or delete anything without asking me first.`;
}