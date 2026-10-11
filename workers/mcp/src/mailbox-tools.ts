// Mailbox tools: creating, listing, enabling/disabling, and deleting
// mailboxes in the D1 registry. There are no Email Routing rules anymore:
// mail to the domain arrives via a single catch-all routing rule (configured
// once), and the email worker accepts only registered, enabled addresses.

import { z } from "zod";

import type { Env } from "./env";
import { randomAddress } from "./names";
import {
  createMailbox,
  deleteAllMessages,
  deleteMailbox as registryDelete,
  listMailboxes,
  RegistryConflictError,
  setMailboxEnabled as registrySetEnabled,
} from "./registry";
import { validateAddress } from "./validation";
import type { McpServer } from "@modelcontextprotocol/server";

/** maxRandomCreateAttempts is how often create_random_mailbox retries with a
 * new random name when the generated address already exists in the registry. */
const MAX_RANDOM_CREATE_ATTEMPTS = 3;

/** text wraps a value as a single JSON text content block. */
function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

/** registerMailboxTools registers the six mailbox tools on the server. */
export function registerMailboxTools(server: McpServer, env: Env): void {
  server.registerTool(
    "create_mailbox",
    {
      description: `Create a mailbox on ${env.DOMAIN}. The address immediately receives mail: mail to the domain arrives via a catch-all routing rule and is accepted when the address is registered.`,
      inputSchema: {
        address: z.string().describe("the mailbox address to create, local@domain"),
      },
    },
    async ({ address }) => {
      const mailbox = validateAddress(address, env);
      const created = await createMailbox(env.REGISTRY, mailbox);
      return text({ address: created.address, enabled: created.enabled, created_at: created.created_at });
    },
  );

  server.registerTool(
    "create_random_mailbox",
    {
      description: `Create a mailbox on ${env.DOMAIN} with a random name like first.last@domain. The address immediately receives mail.`,
      inputSchema: {},
    },
    async () => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < MAX_RANDOM_CREATE_ATTEMPTS; attempt++) {
        const address = randomAddress(env.DOMAIN);
        try {
          const created = await createMailbox(env.REGISTRY, address);
          return text({ address: created.address, enabled: created.enabled, created_at: created.created_at });
        } catch (err) {
          if (err instanceof RegistryConflictError) {
            lastError = err;
            continue;
          }
          throw err;
        }
      }
      throw new Error(`no unique random mailbox after ${MAX_RANDOM_CREATE_ATTEMPTS} attempts: ${String(lastError)}`);
    },
  );

  server.registerTool(
    "list_mailboxes",
    {
      description: `List the mailboxes registered on ${env.DOMAIN}, sorted by address.`,
      inputSchema: {},
    },
    async () => {
      const mailboxes = await listMailboxes(env.REGISTRY);
      return text({ mailboxes });
    },
  );

  server.registerTool(
    "delete_mailbox",
    {
      description: `Delete a mailbox on ${env.DOMAIN}: the address is removed from the registry, it no longer receives mail, and all of its stored messages are permanently deleted.`,
      inputSchema: {
        address: z.string().describe("the mailbox address to delete"),
      },
    },
    async ({ address }) => {
      const mailbox = validateAddress(address, env);
      await registryDelete(env.REGISTRY, mailbox);
      await deleteAllMessages(env.MAILBOX_STORE, mailbox);
      return text({ address: mailbox, deleted: true });
    },
  );

  server.registerTool(
    "enable_mailbox",
    {
      description: `Enable a mailbox on ${env.DOMAIN}: mail to the address is accepted again.`,
      inputSchema: {
        address: z.string().describe("the mailbox address to enable"),
      },
    },
    async ({ address }) => {
      const mailbox = validateAddress(address, env);
      const updated = await registrySetEnabled(env.REGISTRY, mailbox, true);
      return text(updated);
    },
  );

  server.registerTool(
    "disable_mailbox",
    {
      description: `Disable a mailbox on ${env.DOMAIN}: the mailbox keeps existing and keeps its stored mail, but incoming mail is bounced.`,
      inputSchema: {
        address: z.string().describe("the mailbox address to disable"),
      },
    },
    async ({ address }) => {
      const mailbox = validateAddress(address, env);
      const updated = await registrySetEnabled(env.REGISTRY, mailbox, false);
      return text(updated);
    },
  );
}