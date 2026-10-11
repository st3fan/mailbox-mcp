import { beforeEach, describe, expect, it } from "vitest";

import worker from "../src/index";
import type { Env } from "../src/env";
import { FakeD1 } from "./fake-d1";
import { FakeR2Bucket } from "./fake-r2";

const env: Env = {
  MAILBOX_MCP_STORE: new FakeR2Bucket() as unknown as R2Bucket,
  MAILBOX_MCP_REGISTRY: new FakeD1() as unknown as D1Database,
  MAILBOX_MCP_DOMAIN: "example.com",
  MAILBOX_MCP_BEARER_TOKEN: "unused-for-email",
};
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

const rejectCalls: string[] = [];

interface FakeR2BucketType {
  objects: Map<string, { body: ArrayBuffer; contentType?: string }>;
  keys(): string[];
}

/** fakeEmailMessage builds a fake ForwardableEmailMessage with a setReject
 * spy, like the workers runtime provides. */
function fakeEmailMessage(
  from: string,
  to: string,
  headers: Record<string, string>,
  raw: string,
): ForwardableEmailMessage {
  const bytes = new TextEncoder().encode(raw);
  return {
    from,
    to,
    headers: new Headers(headers),
    raw: new Response(bytes).body as ReadableStream,
    rawSize: bytes.byteLength,
    setReject: (reason: string) => {
      rejectCalls.push(reason);
    },
  } as unknown as ForwardableEmailMessage;
}

function bucket(): FakeR2BucketType {
  return env.MAILBOX_MCP_STORE as unknown as FakeR2BucketType;
}

function registry() {
  return (env.MAILBOX_MCP_REGISTRY as unknown as FakeD1).rows;
}

beforeEach(() => {
  bucket().objects.clear();
  registry().clear();
  (env.MAILBOX_MCP_REGISTRY as unknown as FakeD1).lookupFails = false;
  rejectCalls.length = 0;
  // The happy-path test mailboxes are registered and enabled.
  registry().set("alice@example.com", { enabled: 1, created_at: "x" });
  registry().set("bob@example.com", { enabled: 1, created_at: "x" });
});

describe("email ingestion: storage", () => {
  it("stores the raw message and metadata for a registered mailbox", async () => {
    const message = fakeEmailMessage(
      "sender@example.com",
      "Alice@example.com",
      { "message-id": "<m1@example.com>", subject: "Hi" },
      "raw message body",
    );
    await worker.email(message, env, ctx);
    expect(rejectCalls).toEqual([]);

    const keys = [...bucket().objects.keys()].sort();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^alice@example.com\/\d{13}-m1@example\.com\.eml$/);
    expect(keys[1]).toMatch(/^alice@example.com\/\d{13}-m1@example\.com\.json$/);

    const storedRaw = bucket().objects.get(keys[0]!)!;
    expect(new TextDecoder().decode(storedRaw.body)).toBe("raw message body");

    const storedMeta = bucket().objects.get(keys[1]!)!;
    expect(storedMeta.contentType).toBe("application/json");
    const meta = JSON.parse(new TextDecoder().decode(storedMeta.body));
    expect(meta).toMatchObject({
      mailbox: "alice@example.com",
      to: "alice@example.com",
      from: "sender@example.com",
      read: false,
      archived: false,
      size: "raw message body".length,
    });
    expect(meta.id).toBe(keys[0]!.match(/\d{13}-m1@example\.com/)![0]);
  });

  it("writes metadata last, so a failed raw put leaves nothing listable", async () => {
    // Metadata is written last: if the raw put throws, nothing readable is
    // listed by the message listing, which only reads metadata objects.
    const failingRegistry = new FakeD1();
    failingRegistry.rows.set("bob@example.com", { enabled: 1, created_at: "x" });
    const failingBucket = {
      put(key: string) {
        if (key.endsWith(".eml")) {
          throw new Error("storage down");
        }
        return Promise.resolve();
      },
    } as unknown as R2Bucket;
    const failingEnv: Env = {
      MAILBOX_MCP_STORE: failingBucket,
      MAILBOX_MCP_REGISTRY: failingRegistry as unknown as D1Database,
      MAILBOX_MCP_DOMAIN: "example.com",
      MAILBOX_MCP_BEARER_TOKEN: "x",
    };

    const message = fakeEmailMessage("sender@example.com", "bob@example.com", {}, "body");
    await expect(worker.email(message, failingEnv, ctx)).rejects.toThrow("storage down");
  });
});

describe("email ingestion: acceptance check", () => {
  it("rejects unknown addresses with Address not found", async () => {
    const message = fakeEmailMessage("sender@example.com", "nobody@example.com", {}, "body");

    await worker.email(message, env, ctx);

    expect(rejectCalls).toEqual(["Address not found"]);
    expect(bucket().objects.size).toBe(0);
  });

  it("rejects disabled mailboxes with Mailbox disabled", async () => {
    registry().set("bob@example.com", { enabled: 0, created_at: "x" });
    const message = fakeEmailMessage("sender@example.com", "bob@example.com", {}, "body");

    await worker.email(message, env, ctx);

    expect(rejectCalls).toEqual(["Mailbox disabled"]);
    expect(bucket().objects.size).toBe(0);
  });

  it("throws on registry lookup failure so delivery is deferred, not bounced", async () => {
    (env.MAILBOX_MCP_REGISTRY as unknown as FakeD1).lookupFails = true;
    const message = fakeEmailMessage("sender@example.com", "alice@example.com", {}, "body");

    await expect(worker.email(message, env, ctx)).rejects.toThrow("mailbox registry lookup failed");
    expect(rejectCalls).toEqual([]);
    expect(bucket().objects.size).toBe(0);
  });
});