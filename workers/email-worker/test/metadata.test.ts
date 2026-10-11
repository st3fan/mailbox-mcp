import { describe, expect, it } from "vitest";

import { newMetadata } from "../src/metadata";

describe("newMetadata", () => {
  it("starts unread and not archived, with a lowercased mailbox and RFC 3339 receivedAt", () => {
    const md = newMetadata({
      id: "1729-abc",
      from: "Sender <sender@example.com>",
      to: "Alice@Outofscope.Party",
      subject: "  Hello  ",
      receivedAtMillis: Date.UTC(2026, 0, 2, 3, 4, 5),
      size: 1234,
    });

    expect(md).toEqual({
      id: "1729-abc",
      mailbox: "alice@outofscope.party",
      from: "Sender <sender@example.com>",
      to: "alice@outofscope.party",
      subject: "Hello",
      receivedAt: "2026-01-02T03:04:05.000Z",
      size: 1234,
      read: false,
      archived: false,
    });
  });

  it("defaults a missing subject to an empty string", () => {
    const md = newMetadata({
      id: "1-x",
      from: "sender@example.com",
      to: "alice@outofscope.party",
      subject: null,
      receivedAtMillis: 0,
      size: 0,
    });
    expect(md.subject).toBe("");
  });
});