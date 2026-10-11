// Builds the MCP server: instructions, prompts, and tools.

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { Env } from "./env";
import { INSTRUCTIONS, mailboxSummaryPrompt, temporaryEmailPrompt, verificationCodePrompt } from "./guidance";
import { registerMailboxTools } from "./mailbox-tools";
import { registerMessageTools } from "./message-tools";

export const SERVER_NAME = "mailbox-mcp";
export const SERVER_VERSION = "0.5.0";

/** buildServer constructs the MCP server for one request. Stateless serving
 * constructs a fresh instance per request via the factory in index.ts. */
export function buildServer(env: Env): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, {
    instructions: INSTRUCTIONS,
  });

  server.registerPrompt(
    "temporary-email",
    {
      description: "Walk through using a fresh temporary email address: create it, use it, watch for the reply, archive what arrived.",
      argsSchema: {
        purpose: z.string().optional().describe("What the address will be used for, e.g. \"testing the signup form of app.example.com\". Optional."),
      },
    },
    async ({ purpose }) => ({
      messages: [{ role: "user", content: { type: "text", text: temporaryEmailPrompt(purpose ?? "") } }],
    }),
  );

  server.registerPrompt(
    "verification-code",
    {
      description: "Complete an email verification flow: create an address, submit it to the site, poll for the verification mail, extract the link or code.",
      argsSchema: {
        site: z.string().optional().describe("The site or system whose verification flow is being completed. Optional."),
      },
    },
    async ({ site }) => ({
      messages: [{ role: "user", content: { type: "text", text: verificationCodePrompt(site ?? "") } }],
    }),
  );

  server.registerPrompt(
    "mailbox-summary",
    {
      description: "Summarize the messages in one mailbox and suggest what could be archived, without changing anything without confirmation.",
      argsSchema: {
        address: z.string().describe("The mailbox address to summarize, e.g. alice@mail.example.com."),
      },
    },
    async ({ address }) => ({
      messages: [{ role: "user", content: { type: "text", text: mailboxSummaryPrompt(address) } }],
    }),
  );

  registerMessageTools(server, env);
  registerMailboxTools(server, env);

  return server;
}