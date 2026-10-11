import { describe, expect, it } from "vitest";

import {
  createMailbox,
  deleteMailbox,
  getMailbox,
  listMailboxes,
  RegistryConflictError,
  setMailboxEnabled,
} from "../src/registry";
import { FakeD1 } from "./fake-d1";

function db() {
  return new FakeD1() as unknown as D1Database;
}

describe("createMailbox", () => {
  it("inserts an enabled mailbox with a created_at timestamp", async () => {
    const d = db();
    const created = await createMailbox(d, "alice@outofscope.party");
    expect(created).toMatchObject({
      address: "alice@outofscope.party",
      enabled: true,
    });
    expect(created.created_at).toBeTruthy();

    const read = await getMailbox(d, "alice@outofscope.party");
    expect(read).toEqual(created);
  });

  it("throws RegistryConflictError on duplicate addresses", async () => {
    const d = db();
    await createMailbox(d, "alice@outofscope.party");
    await expect(createMailbox(d, "alice@outofscope.party")).rejects.toBeInstanceOf(RegistryConflictError);
    await expect(createMailbox(d, "alice@outofscope.party")).rejects.toThrow("already exists");
  });
});

describe("listMailboxes", () => {
  it("returns all entries sorted by address", async () => {
    const d = db();
    await createMailbox(d, "zeta@outofscope.party");
    await createMailbox(d, "alpha@outofscope.party");
    await createMailbox(d, "mid@outofscope.party");

    const list = await listMailboxes(d);
    expect(list.map((m) => m.address)).toEqual([
      "alpha@outofscope.party",
      "mid@outofscope.party",
      "zeta@outofscope.party",
    ]);
    expect(list.every((m) => typeof m.created_at === "string")).toBe(true);
  });

  it("returns an empty list for an empty registry", async () => {
    expect(await listMailboxes(db())).toEqual([]);
  });
});

describe("setMailboxEnabled", () => {
  it("flips the flag without touching other fields", async () => {
    const d = db();
    const created = await createMailbox(d, "alice@outofscope.party");

    const disabled = await setMailboxEnabled(d, "alice@outofscope.party", false);
    expect(disabled).toEqual({ ...created, enabled: false });

    const enabled = await setMailboxEnabled(d, "alice@outofscope.party", true);
    expect(enabled.enabled).toBe(true);
  });

  it("throws on unknown mailboxes", async () => {
    await expect(setMailboxEnabled(db(), "gone@outofscope.party", true)).rejects.toThrow(
      'mailbox "gone@outofscope.party" not found',
    );
  });
});

describe("deleteMailbox", () => {
  it("removes the registry entry", async () => {
    const d = db();
    await createMailbox(d, "alice@outofscope.party");
    await deleteMailbox(d, "alice@outofscope.party");
    expect(await getMailbox(d, "alice@outofscope.party")).toBeNull();
  });

  it("throws on unknown mailboxes", async () => {
    await expect(deleteMailbox(db(), "gone@outofscope.party")).rejects.toThrow(
      'mailbox "gone@outofscope.party" not found',
    );
  });
});