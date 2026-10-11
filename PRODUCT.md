# PRODUCT.md

This document describes what mailbox-mcp is and what it is deliberately not. It guides
development decisions: work is planned in GitHub issues derived from this document.

## What it is

mailbox-mcp is an MCP server that sits on top of Cloudflare's Email Routing
functionality. With a domain that is onboarded to that service, it can create and
delete mailboxes.

A mailbox is a routing rule that sends email to an Email Worker called
`mailbox-mcp-email-worker`. The Email Worker stores the email in R2.

The MCP also has methods to read the mailbox, read messages, mark messages as read,
delete and archive messages. This is enough functionality.

## Architecture

The project has two parts:

1. **Email Worker on Cloudflare** — receives email routed by Email Routing rules and
   stores it in R2.
2. **MCP server** — a self-hosted MCP server that you can run anywhere. It talks to
   the Cloudflare side using an API key.

On the Cloudflare side an API is exposed that the MCP can talk to.

## Scope

### In scope

- Creating and deleting mailboxes (routing rules) on onboarded domains.
- Reading the mailbox: listing messages.
- Reading individual messages.
- Marking messages as read.
- Deleting and archiving messages.

The project is about **creating temporary email addresses, receiving email, and
managing the mailbox**.

### Out of scope

- **No sending email.** This is a deliberate decision: there is no need for sending
  emails, and no functionality for it will be built.