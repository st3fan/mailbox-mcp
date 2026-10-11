// Package guidance holds the guidance mailbox-mcp advertises to agents: the
// server instructions sent to clients during initialize and the prompt
// templates agents can fetch over prompts/list and prompts/get. The texts
// follow the reviewed drafts in issue #39.
//
// The wording matters: it is how agents learn that the server is for
// temporary receiving addresses, that it cannot send email, and that
// archiving no-longer-needed mail is preferred over deleting it. Tests
// assert that these points survive edits.
package guidance

// Instructions is sent to MCP clients in the initialize response. Written as
// instructions for the agent, in the second person.
const Instructions = `You are connected to mailbox-mcp, an MCP server for temporary email addresses that actually receive mail. Typical uses: testing sign-up flows, sign-in with email (magic link or code) flows, and creating accounts on systems being tested by agents.

This server cannot send email. There is no sending, replying, forwarding, or editing of mail — mailboxes only receive. If a task needs mail to be sent, that has to happen outside this server.

- create_random_mailbox gives you a fresh address like first.last@<domain>. Use it whenever a form, signup, or service needs an email address.
- Mail sent to a mailbox is stored automatically; you do not need to fetch anything. Check a mailbox with list_messages — safe to poll, listing never marks messages read. Read a message in full with read_message, and mark_message_read once you have acted on it.
- Prefer archiving over deleting. When a message is no longer needed, use archive_message: it keeps the mail for later reference while removing it from the way. delete_message destroys a message permanently and cannot be undone — reserve it for noise you are certain about (bouncebacks, obvious spam).
- delete_mailbox removes the mailbox and all its mail permanently. Only delete a mailbox when the address is truly finished with and nothing in it is worth keeping — when in doubt, leave it.
- Addresses must be on the configured domain; anything else is rejected locally before any API call.`
