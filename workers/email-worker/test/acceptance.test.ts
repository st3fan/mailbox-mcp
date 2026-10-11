import { beforeEach, describe, expect, it, vi } from "vitest";

import handler, { type Env } from "../src/index";
import { FakeD1 } from "./fake-d1";

// Minimal in-memory R2 bucket stub, matching the one in handler.test.ts.
class FakeR2Bucket {
  objects = new Map<string, { body: ArrayBuffer; contentType?: string }>();

  async put(key: string, value: ArrayBuffer | string, options?: { httpMetadata?: { contentType?: string } }): Promise<void> {
    const body =
      typeof value === "string" ? new TextEncoder().encode(value).buffer as ArrayBuffer : value;
    this.objects.set(key, { body, contentType: options?.httpMetadata?.contentType });
  }

  async get(key: string): Promise<{ body: ArrayBuffer; contentType?: string } | null> {
    return this.objects.get(key) ?? null;
  }

  keys(): string[] {
    return [...this.objects.keys()];
  }
}

const env: Env = {
  MAILBOX_STORE: new FakeR2Bucket() as unknown as R2Bucket,
  REGISTRY: new FakeD1() as unknown as D1Database,
};
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

interface RejectSpy {
  calls: string[];
}

/** fakeEmailMessage builds a fake ForwardableEmailMessage with a setReject
 * spy, like the workers runtime provides. */
function fakeEmailMessage(
  from: string,
  to: string,
  headers: Record<string, string>,
  raw: string,
): { message: ForwardableEmailMessage; rejects: RejectSpy } {
  const rejects: RejectSpy = { calls: [] };
  const bytes = new TextEncoder().encode(raw);
  const message = {
    from,
    to,
    headers: new Headers(headers),
    raw: new Response(bytes).body as ReadableStream,
    rawSize: bytes.byteLength,
    setReject: (reason: string) => {
      rejects.calls.push(reason);
    },
  };
  return { message: message as unknown as ForwardableEmailMessage, rejects };
}

/** register seeds the registry with an enabled mailbox. */
function register(address: string, enabled = true) {
  (env.REGISTRY as unknown as FakeD1).rows.set(address, { enabled: enabled ? 1 : 0, created_at: "2026-01-01T00:00:00.000Z" });
}

beforeEach(() => {
  (env.MAILBOX_STORE as unknown as FakeR2Bucket).objects.clear();
  (env.REGISTRY as unknown as FakeD1).rows.clear();
  (env.REGISTRY as unknown as FakeD1).lookupFails = false;
});

describe("acceptance check", () => {
  it("stores mail for a registered, enabled mailbox", async () => {
    register("alice@outofscope.party");
    const { message, rejects } = fakeEmailMessage(
      "sender@example.com", "Alice@Outofscope.Party",
      { "message-id": "<m1@example.com>", subject: "Hi" }, "raw body",
    );

    await handler.email(message, env, ctx);

    expect(rejects.calls).toEqual([]);
    const bucket = env.MAILBOX_STORE as unknown as FakeR2Bucket;
    const keys = [...bucket.objects.keys()];
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^alice@outofscope\.party\/\d{13}-m1@example\.com\.eml$/);
    const meta = JSON.parse(new TextDecoder().decode((await bucket.get(keys[1]!))!.body));
    expect(meta).toMatchObject({ mailbox: "alice@outofscope.party", subject: "Hi", read: false });
  });

  it("rejects unknown addresses with Address not found", async () => {
    const { message, rejects } = fakeEmailMessage(
      "sender@example.com", "nobody@outofscope.party", {}, "body",
    );

    await handler.email(message, env, ctx);

    expect(rejects.calls).toEqual(["Address not found"]);
    expect((env.MAILBOX_STORE as unknown as FakeR2Bucket).objects.size).toBe(0);
  });

  it("rejects disabled mailboxes with Mailbox disabled", async () => {
    register("bob@outofscope.party", false);
    const { message, rejects } = fakeEmailMessage(
      "sender@example.com", "bob@outofscope.party", {}, "body",
    );

    await handler.email(message, env, ctx);

    expect(rejects.calls).toEqual(["Mailbox disabled"]);
    expect((env.MAILBOX_STORE as unknown as FakeR2Bucket).objects.size).toBe(0);
  });

  it("throws on registry lookup failure so delivery is deferred, not bounced", async () => {
    (env.REGISTRY as unknown as FakeD1).lookupFails = true;
    const { message, rejects } = fakeEmailMessage(
      "sender@example.com", "alice@outofscope.party", {}, "body",
    );

    await expect(handler.email(message, env, ctx)).rejects.toThrow("mailbox registry lookup failed");
    expect(rejects.calls).toEqual([]);
    expect((env.MAILBOX_STORE as unknown as FakeR2Bucket).objects.size).toBe(0);
  });
});