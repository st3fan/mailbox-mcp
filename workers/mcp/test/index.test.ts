import { beforeEach, describe, expect, it } from "vitest";

import worker from "../src/index";
import type { Env } from "../src/env";
import { FakeD1 } from "./fake-d1";
import { FakeR2Bucket } from "./fake-r2";

const TOKEN = "test-mcp-token";
const env: Env = {
  MAILBOX_MCP_STORE: new FakeR2Bucket() as unknown as R2Bucket,
  MAILBOX_MCP_REGISTRY: new FakeD1() as unknown as D1Database,
  MAILBOX_MCP_DOMAIN: "example.com",
  MAILBOX_MCP_BEARER_TOKEN: TOKEN,
};
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function request(method: string, path: string, token: string | null = TOKEN, body?: unknown): Request {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    headers.accept = "application/json, text/event-stream";
  }
  if (token !== null) {
    headers.authorization = `Bearer ${token}`;
  }
  return new Request(`https://mcp.example.com${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** rpc posts one JSON-RPC request to the endpoint and returns the parsed
 * result or error of the SSE data line. */
async function rpc(id: number, method: string, params?: unknown, token: string | null = TOKEN) {
  const res = await worker.fetch(request("POST", "/mcp", token, {
    jsonrpc: "2.0", id, method, params,
  }), env, ctx);
  const text = await res.text();
  if (res.status !== 200) {
    return { status: res.status, data: null, raw: text };
  }
  const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
  return { status: res.status, data: dataLine ? JSON.parse(dataLine.slice(5)) : null, raw: text };
}

beforeEach(() => {
  (env.MAILBOX_MCP_STORE as unknown as FakeR2Bucket).objects.clear();
});

describe("auth", () => {
  it("rejects missing and wrong tokens with 401 and a challenge", async () => {
    for (const token of [null, "wrong"]) {
      const res = await worker.fetch(request("POST", "/mcp", token, {
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "1" } },
      }), env, ctx);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain("Bearer");
      await expect(res.json()).resolves.toEqual({ error: "unauthorized" });
    }
  });
});

describe("routing", () => {
  it("404s paths other than /mcp", async () => {
    const res = await worker.fetch(request("GET", "/other"), env, ctx);
    expect(res.status).toBe(404);
  });
});

describe("mcp", () => {
  it("answers initialize with server info and instructions", async () => {
    const { status, data } = await rpc(1, "initialize", {
      protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "1" },
    });
    expect(status).toBe(200);
    expect(data.result.serverInfo.name).toBe("mailbox-mcp");
    const instructions: string = data.result.instructions;
    for (const part of ["cannot send email", "Prefer archiving over deleting", "temporary email"]) {
      expect(instructions).toContain(part);
    }
  });

  it("lists the eleven tools and three prompts", async () => {
    const tools = await rpc(2, "tools/list");
    expect(tools.data.result.tools.map((tool: { name: string }) => tool.name).sort())
      .toEqual([
        "archive_message", "create_mailbox", "create_random_mailbox",
        "delete_mailbox", "delete_message", "disable_mailbox",
        "enable_mailbox", "list_mailboxes", "list_messages",
        "mark_message_read", "read_message",
      ]);

    const prompts = await rpc(3, "prompts/list");
    expect(prompts.data.result.prompts.map((p: { name: string }) => p.name).sort())
      .toEqual(["mailbox-summary", "temporary-email", "verification-code"]);
  });

  it("expands prompts with and without arguments", async () => {
    const withPurpose = await rpc(4, "prompts/get", {
      name: "temporary-email", arguments: { purpose: "testing the signup form of app.example.com" },
    });
    const purposeText: string = withPurpose.data.result.messages[0].content.text;
    expect(purposeText).toContain("testing the signup form of app.example.com");
    expect(purposeText).toContain("cannot send email");

    const withoutArgs = await rpc(5, "prompts/get", { name: "temporary-email" });
    expect(withoutArgs.data.result.messages[0].content.text).toContain("infer it from the task at hand");

    const summary = await rpc(6, "prompts/get", {
      name: "mailbox-summary", arguments: { address: "alice@example.com" },
    });
    expect(summary.data.result.messages[0].content.text).toContain("alice@example.com");
  });

  it("errors clearly when a required prompt argument is missing", async () => {
    const res = await rpc(7, "prompts/get", { name: "mailbox-summary", arguments: {} });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.data)).toContain("address");
  });
});