import { describe, expect, it } from "vitest";

import { buildMessageKeys, keyIdFromMessageId, unwrapMessageId } from "../src/keys";

describe("unwrapMessageId", () => {
  it("strips angle brackets and whitespace", () => {
    expect(unwrapMessageId("<abc@example.com>")).toBe("abc@example.com");
    expect(unwrapMessageId("  <abc@example.com> ")).toBe("abc@example.com");
  });

  it("returns the value unchanged when there are no brackets", () => {
    expect(unwrapMessageId("abc@example.com")).toBe("abc@example.com");
  });

  it("returns null for empty and missing values", () => {
    expect(unwrapMessageId(null)).toBeNull();
    expect(unwrapMessageId(undefined)).toBeNull();
    expect(unwrapMessageId("")).toBeNull();
    expect(unwrapMessageId("   ")).toBeNull();
    expect(unwrapMessageId("<>")).toBeNull();
  });
});

describe("keyIdFromMessageId", () => {
  it("keeps allowed characters", () => {
    expect(keyIdFromMessageId("<aB9._-@example.com>")).toBe("aB9._-@example.com");
  });

  it("replaces unsafe characters, including slashes, with dashes", () => {
    expect(keyIdFromMessageId("<a/b@c>")).toBe("a-b@c");
    expect(keyIdFromMessageId("<hello world!>")).toBe("hello-world-");
  });

  it("returns null when nothing usable remains", () => {
    expect(keyIdFromMessageId(null)).toBeNull();
    expect(keyIdFromMessageId("<>")).toBeNull();
    expect(keyIdFromMessageId("<///>")).toBe("---");
  });
});

describe("buildMessageKeys", () => {
  it("builds raw and metadata keys under the mailbox prefix", () => {
    const keys = buildMessageKeys("alice@outofscope.party", 1729, "<m1@example.com>");
    expect(keys.id).toBe("1729-m1@example.com");
    expect(keys.raw).toBe("alice@outofscope.party/1729-m1@example.com.eml");
    expect(keys.metadata).toBe("alice@outofscope.party/1729-m1@example.com.json");
  });

  it("generates a random slug when the Message-ID is unusable, and never collides", () => {
    const a = buildMessageKeys("alice@outofscope.party", 1729, null);
    const b = buildMessageKeys("alice@outofscope.party", 1729, null);
    expect(a.id).toMatch(/^1729-[0-9a-f]{16}$/);
    expect(b.id).toMatch(/^1729-[0-9a-f]{16}$/);
    expect(a.id).not.toBe(b.id);
    expect(a.metadata).toBe("alice@outofscope.party/1729-" + a.id.slice(5) + ".json");
  });
});