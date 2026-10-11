# PRODUCT.md

This document describes what mailbox-mcp is and what it is deliberately not. It guides
development decisions: work is planned in GitHub issues derived from this document.

## What it is

mailbox-mcp is an MCP server that sits on top of Cloudflare's Email Routing
functionality. With a (dedicated) domain that is onboarded to that service,
it can create, list, enable/disable, and delete mailboxes.

A mailbox is an entry in a D1 mailbox registry. A single catch-all routing
rule sends all of the domain's email to an Email Worker called
`mailbox-mcp-email-worker`, which accepts mail for registered, enabled
mailboxes and stores it in R2, bouncing everything else.

The MCP also has methods to read the mailbox, read messages, mark messages as read,
delete and archive messages. This is enough functionality.

## Architecture

The project has two parts:

1. **Email Worker on Cloudflare** — receives email routed by Email Routing rules and
   stores it in R2.
2. **MCP server** — a Cloudflare Worker (`workers/mcp`) serving MCP as streamable
   HTTP at `/mcp` with bearer-token auth. It owns the mailbox registry (D1) and
   message storage (R2). The deprecated SSE transport is deliberately not
   supported; the stdio transport went away with the self-hosted server.

Mailbox management is pure registry bookkeeping: creating, listing,
enabling/disabling, and deleting mailboxes touches only the D1 registry, so
**no Cloudflare API token is involved anywhere**. Incoming mail is routed by
a single catch-all rule (configured once, by hand) to the Email Worker,
which consults the registry and bounces unknown or disabled addresses. The
registry model also removes the routing-rule activation delay: a freshly
created mailbox receives mail immediately.

## Scope

### In scope

- Creating and deleting mailboxes (registry entries on a dedicated domain).
- Reading the mailbox: listing messages.
- Reading individual messages.
- Marking messages as read.
- Deleting and archiving messages.

The project is about **creating temporary email addresses, receiving email, and
managing the mailbox**.

### Out of scope

- **No sending email.** This is a deliberate decision: there is no need for sending
  emails, and no functionality for it will be built.