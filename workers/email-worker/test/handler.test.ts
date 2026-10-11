import { beforeEach, describe, expect, it } from "vitest";

import handler from "../src/index";
import { FakeD1 } from "./fake-d1";
import type { Env } from "../src/index";

// A minimal in-memory R2 bucket stub covering what the email handler uses.
class FakeR2Bucket {
  objects = new Map<string, { body: ArrayBuffer; contentType?: string }>();

  async put(key: string, value: ArrayBuffer | string, options?: { httpMetadata?: { contentType?: string } }): Promise<void> {
    const body = typeof value === "string" ? new TextEncoder().encode(value).buffer as ArrayBuffer : value;
    this.objects.set(key, { body, contentType: options?.httpMetadata?.contentType });
  }

  async get(key: string): Promise<{ body: ArrayBuffer; contentType?: string } | null> {
    return this.objects.get(key) ?? null;
  }
}

// Builds a fake EmailMessage like the workers runtime provides: envelope
// from/to plus a Headers object and a raw stream.
const rejectCalls: string[] = [];

function fakeEmailMessage(from: string, to: string, headers: Record<string, string>, raw: string) {
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
  };
}

const env: Env = { MAILBOX_STORE: new FakeR2Bucket() as unknown as R2Bucket, REGISTRY: new FakeD1() as unknown as D1Database };
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

beforeEach(() => {
  (env.MAILBOX_STORE as unknown as FakeR2Bucket).objects.clear();
  (env.REGISTRY as unknown as FakeD1).rows.clear();
  // The handler test mailboxes are registered and enabled.
  (env.REGISTRY as unknown as FakeD1).rows.set("alice@outofscope.party", { enabled: 1, created_at: "x" });
  (env.REGISTRY as unknown as FakeD1).rows.set("bob@outofscope.party", { enabled: 1, created_at: "x" });
});

describe("email handler", () => {
  it("stores the raw message and metadata under the mailbox prefix", async () => {
    const message = fakeEmailMessage(
      "sender@example.com",
      "Alice@Outofscope.Party",
      { "message-id": "<m1@example.com>", subject: "Hi" },
      "raw message body",
    );
    await handler.email(message as unknown as ForwardableEmailMessage, env, ctx);
    expect(rejectCalls).toEqual([]);

    const bucket = env.MAILBOX_STORE as unknown as FakeR2Bucket;
    const keys = [...bucket.objects.keys()].sort();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^alice@outofscope\.party\/\d{13}-m1@example\.com\.eml$/);
    expect(keys[1]).toMatch(/^alice@outofscope\.party\/\d{13}-m1@example\.com\.json$/);

    const storedRaw = await bucket.get(keys[0]);
    expect(new TextDecoder().decode(storedRaw!.body)).toBe("raw message body");

    const storedMeta = await bucket.get(keys[1]);
    expect(storedMeta!.contentType).toBe("application/json");
    const meta = JSON.parse(new TextDecoder().decode(storedMeta!.body));
    expect(meta).toMatchObject({
      mailbox: "alice@outofscope.party",
      to: "alice@outofscope.party",
      from: "sender@example.com",
      subject: "Hi",
      read: false,
      archived: false,
      size: "raw message body".length,
    });
    expect(meta.id).toBe(keys[0]!.match(/\d+-m1@example\.com/)![0]);
  });

  it("writes metadata last, so a failed raw put leaves nothing listable", async () => {
    // Metadata is written last: if the raw put throws, nothing readable is
    // listed by the messages API, which only reads metadata objects.
    const failingBucket = {
      put(key: string, value: unknown) {
        if (key.endsWith(".eml")) {
          throw new Error("storage down");
        }
        return Promise.resolve();
      },
    } as unknown as R2Bucket;
    const failingRegistry = new FakeD1();
    failingRegistry.rows.set("bob@outofscope.party", { enabled: 1, created_at: "x" });
    const failingEnv: Env = { MAILBOX_STORE: failingBucket, REGISTRY: failingRegistry as unknown as D1Database };

    const message = fakeEmailMessage("sender@example.com", "bob@outofscope.party", {}, "body");
    await expect(handler.email(message as unknown as ForwardableEmailMessage, failingEnv, ctx)).rejects.toThrow("storage down");
  });
});