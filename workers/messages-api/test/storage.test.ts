import { describe, expect, it } from "vitest";

import {
  getMetadata,
  getRaw,
  isValidMessageId,
  listMetadata,
  metadataKey,
  normalizeMailbox,
  patchMetadata,
} from "../src/storage";
import { FakeR2Bucket } from "./fake-r2";

function metadata(id: string, extra: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    mailbox: "alice@outofscope.party",
    from: "sender@example.com",
    to: "alice@outofscope.party",
    subject: "s",
    receivedAt: "2026-01-01T00:00:00.000Z",
    size: 1,
    read: false,
    archived: false,
    ...extra,
  };
}

describe("normalizeMailbox", () => {
  it("lowercases valid addresses", () => {
    expect(normalizeMailbox("Alice@Outofscope.Party")).toBe("alice@outofscope.party");
  });

  it("rejects addresses with slashes, spaces, or multiple @", () => {
    expect(normalizeMailbox("al/ice@x")).toBeNull();
    expect(normalizeMailbox("al ice@x")).toBeNull();
    expect(normalizeMailbox("a@b@c")).toBeNull();
    expect(normalizeMailbox("noatsign")).toBeNull();
  });
});

describe("isValidMessageId", () => {
  it("accepts id-shaped strings", () => {
    expect(isValidMessageId("1729-abc@example.com")).toBe(true);
    expect(isValidMessageId("1-x")).toBe(true);
  });

  it("rejects path-traversal and junk", () => {
    expect(isValidMessageId("a/b")).toBe(false);
    expect(isValidMessageId("..")).toBe(false);
    expect(isValidMessageId("")).toBe(false);
    expect(isValidMessageId("a b")).toBe(false);
  });
});

describe("listMetadata", () => {
  // Ids below follow the email worker's scheme: ascending key order is newest
  // first, so the "smallest" id is the newest message.

  it("returns metadata newest first and skips raw keys", async () => {
    const bucket = new FakeR2Bucket();
    for (const id of ["3-old", "1-new", "2-mid"]) {
      await bucket.put(`alice@outofscope.party/${id}.eml`, "raw");
      await bucket.put(`alice@outofscope.party/${id}.json`, JSON.stringify(metadata(id)));
    }
    await bucket.put("other@outofscope.party/0-x.json", JSON.stringify(metadata("0-x")));

    const page = await listMetadata(bucket as unknown as R2Bucket, "alice@outofscope.party", undefined, 50);
    expect(page.messages.map((m) => m.id)).toEqual(["1-new", "2-mid", "3-old"]);
    expect(page.nextCursor).toBeNull();
  });

  it("paginates with page tokens across short R2 pages", async () => {
    const bucket = new FakeR2Bucket();
    for (const id of ["1-a", "2-b", "3-c", "4-d", "5-e"]) {
      await bucket.put(`alice@outofscope.party/${id}.eml`, "raw");
      await bucket.put(`alice@outofscope.party/${id}.json`, JSON.stringify(metadata(id)));
    }
    const b = bucket as unknown as R2Bucket;

    const p1 = await listMetadata(b, "alice@outofscope.party", undefined, 2);
    expect(p1.messages.map((m) => m.id)).toEqual(["1-a", "2-b"]);
    expect(p1.nextCursor).not.toBeNull();

    const p2 = await listMetadata(b, "alice@outofscope.party", p1.nextCursor!, 2);
    expect(p2.messages.map((m) => m.id)).toEqual(["3-c", "4-d"]);

    const p3 = await listMetadata(b, "alice@outofscope.party", p2.nextCursor!, 2);
    expect(p3.messages.map((m) => m.id)).toEqual(["5-e"]);
    expect(p3.nextCursor).toBeNull();
  });

  it("returns an empty page for an unknown mailbox", async () => {
    const page = await listMetadata(new FakeR2Bucket() as unknown as R2Bucket, "nobody@outofscope.party", undefined, 50);
    expect(page.messages).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});

describe("getMetadata / getRaw / patchMetadata", () => {
  it("round-trips metadata and raw text", async () => {
    const bucket = new FakeR2Bucket() as unknown as R2Bucket;
    await bucket.put(metadataKey("alice@outofscope.party", "1-a"), JSON.stringify(metadata("1-a")));
    await bucket.put("alice@outofscope.party/1-a.eml", "raw body");

    expect(await getMetadata(bucket, "alice@outofscope.party", "1-a")).toMatchObject({ id: "1-a" });
    expect(await getRaw(bucket, "alice@outofscope.party", "1-a")).toBe("raw body");
    expect(await getMetadata(bucket, "alice@outofscope.party", "9-z")).toBeNull();
    expect(await getRaw(bucket, "alice@outofscope.party", "9-z")).toBeNull();
  });

  it("patches flags without touching other fields", async () => {
    const bucket = new FakeR2Bucket();
    const key = metadataKey("alice@outofscope.party", "1-a");
    await bucket.put(key, JSON.stringify(metadata("1-a")));
    const b = bucket as unknown as R2Bucket;
    const before = (await getMetadata(b, "alice@outofscope.party", "1-a"))!;

    const updated = await patchMetadata(b, before, { read: true, archived: true });
    expect(updated.read).toBe(true);
    expect(updated.archived).toBe(true);
    expect(updated.subject).toBe("s");

    const reread = (await getMetadata(b, "alice@outofscope.party", "1-a"))!;
    expect(reread.read).toBe(true);
    expect(reread.archived).toBe(true);
  });
});