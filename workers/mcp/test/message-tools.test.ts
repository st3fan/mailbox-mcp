import { beforeEach, describe, expect, it } from "vitest";

import worker from "../src/index";
import type { Env } from "../src/env";
import { FakeD1 } from "./fake-d1";
import { FakeR2Bucket } from "./fake-r2";

const TOKEN = "test-mcp-token";
const env: Env = {
  MAILBOX_STORE: new FakeR2Bucket() as unknown as R2Bucket,
  REGISTRY: new FakeD1() as unknown as D1Database,
  DOMAIN: "outofscope.party",
  EMAIL_WORKER: "mailbox-mcp-email-worker",
  CLOUDFLARE_API_TOKEN: "test-cf-token",
  MCP_AUTH_TOKEN: TOKEN,
};
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

/** rpc posts a tools/call JSON-RPC request and returns the parsed result or
 * error of the SSE data line. */
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
  (env.MAILBOX_STORE as unknown as FakeR2Bucket).objects.clear();
});

describe("list_messages", () => {
  it("lists messages newest first and never marks read", async () => {
    await putMessage("alice@outofscope.party", "2-old", "old", "r1");
    await putMessage("alice@outofscope.party", "1-new", "new", "r2");

    const { isError, text } = await callTool(1, "list_messages", { address: "alice@outofscope.party" });
    expect(isError).toBe(false);
    const out = JSON.parse(text);
    expect(out.messages.map((m: { id: string }) => m.id)).toEqual(["1-new", "2-old"]);
    expect(out.nextPageToken).toBeUndefined();
    // Listing is side-effect free: metadata objects unchanged.
    const bucket = env.MAILBOX_STORE as unknown as FakeR2Bucket;
    const meta = JSON.parse(new TextDecoder().decode((await bucket.get("alice@outofscope.party/1-new.json"))!.body));
    expect(meta.read).toBe(false);
  });

  it("rejects off-domain addresses locally", async () => {
    const { isError, text } = await callTool(2, "list_messages", { address: "alice@elsewhere.example" });
    expect(isError).toBe(true);
    expect(text).toContain("is not a mailbox on outofscope.party");
    expect((env.MAILBOX_STORE as unknown as FakeR2Bucket).objects.size).toBe(0);
  });
});

describe("read_message", () => {
  it("returns metadata and raw content and marks read", async () => {
    await putMessage("alice@outofscope.party", "1-a", "Hello", "raw body");

    const { isError, text } = await callTool(3, "read_message", {
      address: "alice@outofscope.party", id: "1-a",
    });
    expect(isError).toBe(false);
    const out = JSON.parse(text);
    expect(out.message.subject).toBe("Hello");
    expect(out.message.read).toBe(true);
    expect(out.raw).toBe("raw body");

    // The flag change is persisted in the bucket.
    const bucket = env.MAILBOX_STORE as unknown as FakeR2Bucket;
    const meta = JSON.parse(new TextDecoder().decode((await bucket.get("alice@outofscope.party/1-a.json"))!.body));
    expect(meta.read).toBe(true);
  });

  it("404s unknown messages", async () => {
    const { isError, text } = await callTool(4, "read_message", {
      address: "alice@outofscope.party", id: "9-z",
    });
    expect(isError).toBe(true);
    expect(text).toContain('message "9-z" not found in "alice@outofscope.party"');
  });

  it("requires an id", async () => {
    await putMessage("alice@outofscope.party", "1-a", "s", "raw");
    const { isError, text } = await callTool(5, "read_message", {
      address: "alice@outofscope.party", id: " ",
    });
    expect(isError).toBe(true);
    expect(text).toContain("id is required");
  });
});

describe("mark_message_read and archive_message", () => {
  it("mark flags without touching other fields", async () => {
    await putMessage("alice@outofscope.party", "1-a", "s", "raw");

    const read = await callTool(6, "mark_message_read", { address: "alice@outofscope.party", id: "1-a" });
    expect(read.isError).toBe(false);
    expect(JSON.parse(read.text).message).toMatchObject({ read: true, archived: false });

    const archive = await callTool(7, "archive_message", { address: "alice@outofscope.party", id: "1-a" });
    expect(archive.isError).toBe(false);
    expect(JSON.parse(archive.text).message).toMatchObject({ read: true, archived: true });
  });

  it("404 unknown messages", async () => {
    const read = await callTool(8, "mark_message_read", { address: "alice@outofscope.party", id: "9-z" });
    expect(read.isError).toBe(true);
    expect(read.text).toContain("not found");
  });
});

describe("delete_message", () => {
  it("deletes both objects and then 404s", async () => {
    await putMessage("alice@outofscope.party", "1-a", "s", "raw");

    const del = await callTool(9, "delete_message", { address: "alice@outofscope.party", id: "1-a" });
    expect(del.isError).toBe(false);
    expect(JSON.parse(del.text)).toEqual({ deleted: true });
    expect((env.MAILBOX_STORE as unknown as FakeR2Bucket).objects.size).toBe(0);

    const again = await callTool(10, "delete_message", { address: "alice@outofscope.party", id: "1-a" });
    expect(again.isError).toBe(true);
    expect(again.text).toContain("not found");
  });
});