// Message tools: reading the mailbox and managing its messages, on the
// R2-backed storage this worker owns. Ported from the Go
// internal/mailboxes/messages.go. Behavior matches main: list_messages is
// side-effect free, read_message marks the message as read in the same call.

import { z } from "zod";

import type { Env } from "./env";
import {
  deleteMessage,
  getMetadata,
  getRaw,
  listMetadata,
  patchMetadata,
  type MessageMetadata,
} from "./storage";
import { validateAddress } from "./validation";
import type { McpServer } from "@modelcontextprotocol/server";

const LIST_LIMIT = 50;

/** text wraps a value as a single JSON text content block, the tool-result
 * shape our tools use. */
function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

/** notFound is the error for unknown messages and mailboxes. */
function notFound(kind: string, id: string, mailbox: string): Error {
  return new Error(`${kind} "${id}" not found in "${mailbox}"`);
}

/** requireMetadata fetches a message's metadata or throws a not-found error. */
async function requireMetadata(env: Env, mailbox: string, id: string): Promise<MessageMetadata> {
  const metadata = await getMetadata(env.MAILBOX_MCP_STORE, mailbox, id);
  if (metadata === null) {
    throw notFound("message", id, mailbox);
  }
  return metadata;
}

/** registerMessageTools registers the five message tools on the server. */
export function registerMessageTools(server: McpServer, env: Env): void {
  server.registerTool(
    "list_messages",
    {
      description: `List the messages of a mailbox on ${env.MAILBOX_MCP_DOMAIN}, newest first. Returns metadata and a page token for the next page. Never marks messages read.`,
      inputSchema: {
        address: z.string().describe("the mailbox address to list messages for"),
        pageToken: z.string().optional().describe("page token from a previous list_messages result, to get the next page"),
      },
    },
    async ({ address, pageToken }) => {
      const mailbox = validateAddress(address, env);
      const page = await listMetadata(env.MAILBOX_MCP_STORE, mailbox, pageToken, LIST_LIMIT);
      return text({ messages: page.messages, nextPageToken: page.nextCursor ?? undefined });
    },
  );

  server.registerTool(
    "read_message",
    {
      description: `Read one message of a mailbox on ${env.MAILBOX_MCP_DOMAIN}: its metadata and raw content. Marks the message as read automatically.`,
      inputSchema: {
        address: z.string().describe("the mailbox address the message belongs to"),
        id: z.string().describe("the message id, from a list_messages result"),
      },
    },
    async ({ address, id }) => {
      const mailbox = validateAddress(address, env);
      const messageId = id.trim();
      if (messageId === "") {
        throw new Error("id is required");
      }
      const stored = await getMetadata(env.MAILBOX_MCP_STORE, mailbox, messageId);
      if (stored === null) {
        throw notFound("message", messageId, mailbox);
      }
      const raw = await getRaw(env.MAILBOX_MCP_STORE, mailbox, messageId);
      if (raw === null) {
        // Metadata without raw bytes should not happen (the email worker
        // writes raw first); treat it as missing rather than returning an
        // empty message.
        throw notFound("message", messageId, mailbox);
      }
      const updated = await patchMetadata(env.MAILBOX_MCP_STORE, stored, { read: true });
      return text({ message: updated, raw });
    },
  );

  server.registerTool(
    "mark_message_read",
    {
      description: `Mark a message of a mailbox on ${env.MAILBOX_MCP_DOMAIN} as read without re-reading it.`,
      inputSchema: {
        address: z.string().describe("the mailbox address the message belongs to"),
        id: z.string().describe("the message id, from a list_messages result"),
      },
    },
    async ({ address, id }) => {
      const mailbox = validateAddress(address, env);
      const messageId = id.trim();
      if (messageId === "") {
        throw new Error("id is required");
      }
      const metadata = await requireMetadata(env, mailbox, messageId);
      const updated = await patchMetadata(env.MAILBOX_MCP_STORE, metadata, { read: true });
      return text({ message: updated });
    },
  );

  server.registerTool(
    "archive_message",
    {
      description: `Archive a message of a mailbox on ${env.MAILBOX_MCP_DOMAIN}.`,
      inputSchema: {
        address: z.string().describe("the mailbox address the message belongs to"),
        id: z.string().describe("the message id, from a list_messages result"),
      },
    },
    async ({ address, id }) => {
      const mailbox = validateAddress(address, env);
      const messageId = id.trim();
      if (messageId === "") {
        throw new Error("id is required");
      }
      const metadata = await requireMetadata(env, mailbox, messageId);
      const updated = await patchMetadata(env.MAILBOX_MCP_STORE, metadata, { archived: true });
      return text({ message: updated });
    },
  );

  server.registerTool(
    "delete_message",
    {
      description: `Delete a message of a mailbox on ${env.MAILBOX_MCP_DOMAIN}. Permanent.`,
      inputSchema: {
        address: z.string().describe("the mailbox address the message belongs to"),
        id: z.string().describe("the message id, from a list_messages result"),
      },
    },
    async ({ address, id }) => {
      const mailbox = validateAddress(address, env);
      const messageId = id.trim();
      if (messageId === "") {
        throw new Error("id is required");
      }
      await requireMetadata(env, mailbox, messageId);
      await deleteMessage(env.MAILBOX_MCP_STORE, mailbox, messageId);
      return text({ deleted: true });
    },
  );
}