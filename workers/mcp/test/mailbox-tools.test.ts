import { beforeEach, describe, expect, it, vi } from "vitest";

import worker from "../src/index";
import type { Env } from "../src/env";
import { FakeD1 } from "./fake-d1";
import { FakeR2Bucket } from "./fake-r2";

// create_random_mailbox's retry behavior is tested with a controlled name
// generator; each test configures the sequence it needs.
const randomAddress = vi.fn();
vi.mock("../src/names", () => ({ randomAddress: (domain: string) => randomAddress(domain) }));

const TOKEN = "test-mcp-token";
const env: Env = {
  MAILBOX_STORE: new FakeR2Bucket() as unknown as R2Bucket,
  REGISTRY: new FakeD1() as unknown as D1Database,
  DOMAIN: "example.com",
  MCP_AUTH_TOKEN: TOKEN,
};
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

/** callTool posts a tools/call JSON-RPC request and returns the parsed result
 * or error of the SSE data line. */
async function callTool(id: number, name: string, args: Record<string, unknown>) {
  const res = await worker.fetch(new Request("http://x/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
  }), env, ctx);
  const text = await res.text();
  const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
  const data = dataLine ? JSON.parse(dataLine.slice(5)) : null;
  const resultText = data?.result?.content?.[0]?.text ?? "";
  return { status: res.status, result: data?.result, text: resultText, isError: data?.result?.isError === true };
}

/** registryView returns the raw rows behind the fake D1, for asserting
 * persistence directly. */
function registry() {
  return (env.REGISTRY as unknown as FakeD1).rows;
}

/** putMessage stores a message's raw and metadata objects in the fake bucket,
 * like the email worker does. */
async function putMessage(mailbox: string, id: string, subject: string, raw: string) {
  const bucket = env.MAILBOX_STORE as unknown as FakeR2Bucket;
  await bucket.put(`${mailbox}/${id}.eml`, raw);
  await bucket.put(
    `${mailbox}/${id}.json`,
    JSON.stringify({
      id, mailbox, from: "sender@example.com", to: mailbox, subject,
      receivedAt: "2026-01-01T00:00:00.000Z", size: raw.length, read: false, archived: false,
    }),
    { httpMetadata: { contentType: "application/json" } },
  );
}

beforeEach(() => {
  randomAddress.mockReset();
  (env.REGISTRY as unknown as FakeD1).rows.clear();
});

describe("create_mailbox", () => {
  it("creates a registered, enabled mailbox", async () => {
    const { isError, text } = await callTool(1, "create_mailbox", { address: "alice@example.com" });
    expect(isError).toBe(false);
    const out = JSON.parse(text);
    expect(out).toMatchObject({ address: "alice@example.com", enabled: true });
    expect(out.created_at).toBeTruthy();
    expect(registry().has("alice@example.com")).toBe(true);
  });

  it("errors on duplicate addresses", async () => {
    await callTool(2, "create_mailbox", { address: "alice@example.com" });
    const { isError, text } = await callTool(3, "create_mailbox", { address: "alice@example.com" });
    expect(isError).toBe(true);
    expect(text).toContain("already exists");
  });

  it("rejects off-domain addresses locally", async () => {
    const { isError, text } = await callTool(4, "create_mailbox", { address: "alice@elsewhere.example" });
    expect(isError).toBe(true);
    expect(text).toContain("is not a mailbox on example.com");
    expect(registry().size).toBe(0);
  });
});

describe("create_random_mailbox", () => {
  it("creates a mailbox with a generated name", async () => {
    randomAddress.mockReturnValue("alpha.bravo@example.com");
    const { isError, text } = await callTool(5, "create_random_mailbox", {});
    expect(isError).toBe(false);
    const out = JSON.parse(text);
    expect(out).toMatchObject({ address: "alpha.bravo@example.com", enabled: true });
    expect(registry().has("alpha.bravo@example.com")).toBe(true);
  });

  it("retries with a new name when the generated address already exists", async () => {
    (env.REGISTRY as unknown as FakeD1).rows.set("taken@example.com", { enabled: 1, created_at: "x" });
    randomAddress.mockReturnValueOnce("taken@example.com").mockReturnValueOnce("fresh@example.com");

    const { isError, text } = await callTool(6, "create_random_mailbox", {});
    expect(isError).toBe(false);
    expect(JSON.parse(text).address).toBe("fresh@example.com");
  });

  it("gives up after three conflicts", async () => {
    (env.REGISTRY as unknown as FakeD1).rows.set("taken@example.com", { enabled: 1, created_at: "x" });
    randomAddress.mockReturnValue("taken@example.com");

    const { isError, text } = await callTool(7, "create_random_mailbox", {});
    expect(isError).toBe(true);
    expect(text).toContain("no unique random mailbox after 3 attempts");
  });
});

describe("list_mailboxes", () => {
  it("lists registry entries sorted by address", async () => {
    await callTool(8, "create_mailbox", { address: "zeta@example.com" });
    await callTool(9, "create_mailbox", { address: "alpha@example.com" });

    const { isError, text } = await callTool(10, "list_mailboxes", {});
    expect(isError).toBe(false);
    const out = JSON.parse(text);
    expect(out.mailboxes.map((m: { address: string }) => m.address))
      .toEqual(["alpha@example.com", "zeta@example.com"]);
  });
});

describe("delete_mailbox", () => {
  it("removes the registry entry and all stored messages", async () => {
    await callTool(11, "create_mailbox", { address: "alpha@example.com" });
    // Two messages for alpha, plus one for another mailbox that must survive.
    await putMessage("alpha@example.com", "1-a", "s", "raw one");
    await putMessage("alpha@example.com", "2-b", "s", "raw two");
    await putMessage("beta@example.com", "1-c", "s", "raw three");

    const { isError, text } = await callTool(12, "delete_mailbox", { address: "alpha@example.com" });
    expect(isError).toBe(false);
    expect(JSON.parse(text)).toEqual({ address: "alpha@example.com", deleted: true });
    expect(registry().has("alpha@example.com")).toBe(false);

    const bucket = env.MAILBOX_STORE as unknown as FakeR2Bucket;
    expect(bucket.keys().filter((k) => k.startsWith("alpha@example.com/"))).toEqual([]);
    expect(bucket.keys().filter((k) => k.startsWith("beta@example.com/"))).toHaveLength(2);
  });

  it("404s unknown mailboxes", async () => {
    const { isError, text } = await callTool(13, "delete_mailbox", { address: "gone@example.com" });
    expect(isError).toBe(true);
    expect(text).toContain('mailbox "gone@example.com" not found');
  });
});

describe("enable_mailbox and disable_mailbox", () => {
  it("flip the enabled flag", async () => {
    await callTool(14, "create_mailbox", { address: "alpha@example.com" });

    const disable = await callTool(15, "disable_mailbox", { address: "alpha@example.com" });
    expect(disable.isError).toBe(false);
    expect(JSON.parse(disable.text)).toMatchObject({ address: "alpha@example.com", enabled: false });

    const enable = await callTool(16, "enable_mailbox", { address: "alpha@example.com" });
    expect(enable.isError).toBe(false);
    expect(JSON.parse(enable.text).enabled).toBe(true);
  });

  it("404 unknown mailboxes", async () => {
    const disable = await callTool(17, "disable_mailbox", { address: "gone@example.com" });
    expect(disable.isError).toBe(true);
    expect(disable.text).toContain("not found");
  });
});