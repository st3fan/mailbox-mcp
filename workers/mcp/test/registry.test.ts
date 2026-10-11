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
    const created = await createMailbox(d, "alice@example.com");
    expect(created).toMatchObject({
      address: "alice@example.com",
      enabled: true,
    });
    expect(created.created_at).toBeTruthy();

    const read = await getMailbox(d, "alice@example.com");
    expect(read).toEqual(created);
  });

  it("throws RegistryConflictError on duplicate addresses", async () => {
    const d = db();
    await createMailbox(d, "alice@example.com");
    await expect(createMailbox(d, "alice@example.com")).rejects.toBeInstanceOf(RegistryConflictError);
    await expect(createMailbox(d, "alice@example.com")).rejects.toThrow("already exists");
  });
});

describe("listMailboxes", () => {
  it("returns all entries sorted by address", async () => {
    const d = db();
    await createMailbox(d, "zeta@example.com");
    await createMailbox(d, "alpha@example.com");
    await createMailbox(d, "mid@example.com");

    const list = await listMailboxes(d);
    expect(list.map((m) => m.address)).toEqual([
      "alpha@example.com",
      "mid@example.com",
      "zeta@example.com",
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
    const created = await createMailbox(d, "alice@example.com");

    const disabled = await setMailboxEnabled(d, "alice@example.com", false);
    expect(disabled).toEqual({ ...created, enabled: false });

    const enabled = await setMailboxEnabled(d, "alice@example.com", true);
    expect(enabled.enabled).toBe(true);
  });

  it("throws on unknown mailboxes", async () => {
    await expect(setMailboxEnabled(db(), "gone@example.com", true)).rejects.toThrow(
      'mailbox "gone@example.com" not found',
    );
  });
});

describe("deleteMailbox", () => {
  it("removes the registry entry", async () => {
    const d = db();
    await createMailbox(d, "alice@example.com");
    await deleteMailbox(d, "alice@example.com");
    expect(await getMailbox(d, "alice@example.com")).toBeNull();
  });

  it("throws on unknown mailboxes", async () => {
    await expect(deleteMailbox(db(), "gone@example.com")).rejects.toThrow(
      'mailbox "gone@example.com" not found',
    );
  });
});