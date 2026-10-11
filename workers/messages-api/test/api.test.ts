import { beforeEach, describe, expect, it } from "vitest";

import handler from "../src/index";
import type { Env } from "../src/index";
import { FakeR2Bucket } from "./fake-r2";

const TOKEN = "test-token";
const env: Env = {
  MAILBOX_STORE: new FakeR2Bucket() as unknown as R2Bucket,
  MESSAGES_API_TOKEN: TOKEN,
};
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function request(method: string, path: string, token: string | null = TOKEN): Request {
  const headers: Record<string, string> = {};
  if (token !== null) {
    headers.authorization = `Bearer ${token}`;
  }
  return new Request(`https://api.example.com${path}`, { method, headers });
}

// Typed JSON body reader: res.json() is unknown under strict TS.
function parse<T = any>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

function putMessage(mailbox: string, id: string, subject: string, raw: string) {
  const bucket = env.MAILBOX_STORE as unknown as FakeR2Bucket;
  return Promise.all([
    bucket.put(`${mailbox}/${id}.eml`, raw),
    bucket.put(
      `${mailbox}/${id}.json`,
      JSON.stringify({
        id,
        mailbox,
        from: "sender@example.com",
        to: mailbox,
        subject,
        receivedAt: "2026-01-01T00:00:00.000Z",
        size: raw.length,
        read: false,
        archived: false,
      }),
      { httpMetadata: { contentType: "application/json" } },
    ),
  ]);
}

beforeEach(() => {
  (env.MAILBOX_STORE as unknown as FakeR2Bucket).objects.clear();
});

describe("auth", () => {
  it("rejects missing and wrong tokens with 401", async () => {
    for (const token of [null, "wrong"]) {
      const res = await handler.fetch(request("GET", "/mailboxes/a@b/messages", token), env, ctx);
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: "unauthorized" });
    }
  });
});

describe("routing and validation", () => {
  it("404s unknown paths", async () => {
    const res = await handler.fetch(request("GET", "/nope"), env, ctx);
    expect(res.status).toBe(404);
  });

  it("400s invalid mailbox addresses and message ids", async () => {
    expect((await handler.fetch(request("GET", "/mailboxes/notanaddress/messages"), env, ctx)).status).toBe(400);
    expect((await handler.fetch(request("GET", "/mailboxes/a@b/messages/a%2Fb"), env, ctx)).status).toBe(400);
  });

  it("405s wrong methods on known resources", async () => {
    expect((await handler.fetch(request("DELETE", "/mailboxes/a@b/messages"), env, ctx)).status).toBe(405);
  });
});

describe("list, read, flags, delete", () => {
  it("lists messages newest first with metadata only", async () => {
    await putMessage("alice@outofscope.party", "2-old", "old", "r1");
    await putMessage("alice@outofscope.party", "1-new", "new", "r2");

    const res = await handler.fetch(request("GET", "/mailboxes/alice@outofscope.party/messages"), env, ctx);
    expect(res.status).toBe(200);
    const body = await parse(res);
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual(["1-new", "2-old"]);
    expect(body.messages[0]).toMatchObject({ subject: "new", read: false, archived: false });
    expect(body.nextPageToken).toBeNull();
  });

  it("respects the limit and returns a nextPageToken when truncated", async () => {
    for (const id of ["1-a", "2-b", "3-c", "4-d", "5-e"]) {
      await putMessage("alice@outofscope.party", id, "s", "raw");
    }
    const res = await handler.fetch(
      request("GET", "/mailboxes/alice@outofscope.party/messages?limit=2"),
      env,
      ctx,
    );
    const body = await parse(res);
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual(["1-a", "2-b"]);
    expect(body.nextPageToken).not.toBeNull();

    const res2 = await handler.fetch(
      request("GET", `/mailboxes/alice@outofscope.party/messages?limit=2&cursor=${encodeURIComponent(body.nextPageToken)}`),
      env,
      ctx,
    );
    const body2 = await parse(res2);
    expect(body2.messages.map((m: { id: string }) => m.id)).toEqual(["3-c", "4-d"]);
    expect(body2.nextPageToken).not.toBeNull();

    const res3 = await handler.fetch(
      request("GET", `/mailboxes/alice@outofscope.party/messages?limit=2&cursor=${encodeURIComponent(body2.nextPageToken)}`),
      env,
      ctx,
    );
    const body3 = await parse(res3);
    expect(body3.messages.map((m: { id: string }) => m.id)).toEqual(["5-e"]);
    expect(body3.nextPageToken).toBeNull();
  });

  it("reads a message with metadata and raw content", async () => {
    await putMessage("alice@outofscope.party", "1-a", "Hello", "raw body");
    const res = await handler.fetch(request("GET", "/mailboxes/alice@outofscope.party/messages/1-a"), env, ctx);
    expect(res.status).toBe(200);
    const body = await parse(res);
    expect(body.message.subject).toBe("Hello");
    expect(body.raw).toBe("raw body");
  });

  it("404s reads of unknown messages", async () => {
    const res = await handler.fetch(request("GET", "/mailboxes/alice@outofscope.party/messages/9-nope"), env, ctx);
    expect(res.status).toBe(404);
  });

  it("marks read and archives via POST", async () => {
    await putMessage("alice@outofscope.party", "1-a", "s", "raw");

    const read = await handler.fetch(request("POST", "/mailboxes/alice@outofscope.party/messages/1-a/read"), env, ctx);
    expect(read.status).toBe(200);
    expect((await parse(read)).message).toMatchObject({ read: true, archived: false });

    const archive = await handler.fetch(request("POST", "/mailboxes/alice@outofscope.party/messages/1-a/archive"), env, ctx);
    expect(archive.status).toBe(200);
    expect((await parse(archive)).message).toMatchObject({ read: true, archived: true });
  });

  it("deletes both objects and then 404s", async () => {
    await putMessage("alice@outofscope.party", "1-a", "s", "raw");
    const del = await handler.fetch(request("DELETE", "/mailboxes/alice@outofscope.party/messages/1-a"), env, ctx);
    expect(del.status).toBe(200);
    await expect(del.json()).resolves.toEqual({ deleted: true });
    expect((env.MAILBOX_STORE as unknown as FakeR2Bucket).keys()).toHaveLength(0);

    const again = await handler.fetch(request("DELETE", "/mailboxes/alice@outofscope.party/messages/1-a"), env, ctx);
    expect(again.status).toBe(404);
  });
});