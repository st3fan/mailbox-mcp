import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import worker from "../src/index";
import { resetZoneCacheForTests } from "../src/mailbox-tools";
import type { Env } from "../src/env";
import { FakeR2Bucket } from "./fake-r2";

const TOKEN = "test-mcp-token";
const env: Env = {
  MAILBOX_STORE: new FakeR2Bucket() as unknown as R2Bucket,
  DOMAIN: "outofscope.party",
  EMAIL_WORKER: "mailbox-mcp-email-worker",
  CLOUDFLARE_API_TOKEN: "test-cf-token",
  MCP_AUTH_TOKEN: TOKEN,
};
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

/** callTool posts a tools/call JSON-RPC request and returns the parsed result
 * or error of the SSE data line. */
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

interface RecordedCall {
  method: string;
  url: string;
  body?: unknown;
  authorization?: string | null;
}

/** ApiError marks a mocked API error response. */
function apiError(code: number, message: string) {
  return { __apiError: { code, message } };
}

const isApiError = (v: unknown): v is { __apiError: { code: number; message: string } } =>
  typeof v === "object" && v !== null && "__apiError" in v;

type MockRoute = { when: (method: string, path: string) => boolean; respond: () => unknown };

/** mockCloudflare replaces global fetch with a router over Cloudflare API
 * paths, recording every call. Routes return the result value, or an
 * apiError() sentinel for error responses. */
function mockCloudflare(routes: MockRoute[]): { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const mocked = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const path = new URL(req.url).pathname + new URL(req.url).search;
    calls.push({
      method: req.method,
      url: path,
      body: req.body ? JSON.parse(await req.text()) : undefined,
      authorization: req.headers.get("authorization"),
    });
    for (const route of routes) {
      if (route.when(req.method, path)) {
        const response = route.respond();
        if (isApiError(response)) {
          return new Response(
            JSON.stringify({ success: false, errors: [response.__apiError] }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ success: true, errors: [], result: response }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response(
      JSON.stringify({ success: false, errors: [{ code: 404, message: "route not mocked" }] }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", mocked);
  return { calls };
}

const zoneRoute: MockRoute = {
  when: (method, path) => method === "GET" && path.startsWith("/client/v4/zones?name="),
  respond: () => [{ id: "zone-1", name: "outofscope.party" }],
};

function rulesRoute(when: (method: string, path: string) => boolean, respond: () => unknown): MockRoute {
  return { when, respond };
}

beforeEach(() => {
  resetZoneCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("create_mailbox", () => {
  it("creates a rule with the exact address and worker action", async () => {
    const { calls } = mockCloudflare([
      zoneRoute,
      rulesRoute((m, p) => m === "POST" && p === "/client/v4/zones/zone-1/email/routing/rules",
        () => ({ id: "rule-1", name: "alice@outofscope.party", enabled: true })),
    ]);

    const { isError, text } = await callTool(1, "create_mailbox", { address: "alice@outofscope.party" });
    expect(isError).toBe(false);
    expect(JSON.parse(text)).toEqual({
      address: "alice@outofscope.party", rule_id: "rule-1", enabled: true,
    });

    const post = calls.find((c) => c.method === "POST");
    expect(post?.url).toBe("/client/v4/zones/zone-1/email/routing/rules");
    expect(post?.authorization).toBe("Bearer test-cf-token");
    expect(post?.body).toEqual({
      name: "alice@outofscope.party",
      enabled: true,
      matchers: [{ type: "literal", field: "to", value: "alice@outofscope.party" }],
      actions: [{ type: "worker", value: ["mailbox-mcp-email-worker"] }],
    });
  });

  it("rejects off-domain addresses locally without creating a rule", async () => {
    const { calls } = mockCloudflare([zoneRoute]);
    const { isError, text } = await callTool(2, "create_mailbox", { address: "alice@elsewhere.example" });
    expect(isError).toBe(true);
    expect(text).toContain("is not a mailbox on outofscope.party");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});

describe("create_random_mailbox", () => {
  it("retries with a new name when Cloudflare reports a duplicate", async () => {
    let posts = 0;
    mockCloudflare([
      zoneRoute,
      rulesRoute((m, p) => m === "POST" && p === "/client/v4/zones/zone-1/email/routing/rules", () => {
        posts++;
        if (posts === 1) {
          return apiError(10004, "routing rule already exists");
        }
        return { id: "rule-2", name: "ok", enabled: true };
      }),
    ]);

    const { isError, text } = await callTool(3, "create_random_mailbox", {});
    expect(isError).toBe(false);
    const out = JSON.parse(text);
    expect(out.rule_id).toBe("rule-2");
    expect(posts).toBe(2);
  });

  it("gives up after three duplicate attempts", async () => {
    let posts = 0;
    mockCloudflare([
      zoneRoute,
      rulesRoute((m, p) => m === "POST" && p === "/client/v4/zones/zone-1/email/routing/rules", () => {
        posts++;
        return apiError(10004, "routing rule already exists");
      }),
    ]);

    const { isError, text } = await callTool(4, "create_random_mailbox", {});
    expect(isError).toBe(true);
    expect(text).toContain("no unique random mailbox after 3 attempts");
    expect(posts).toBe(3);
  });
});

describe("list_mailboxes", () => {
  it("lists only mailbox rules routed to the email worker, sorted", async () => {
    mockCloudflare([
      zoneRoute,
      rulesRoute((m, p) => m === "GET" && p === "/client/v4/zones/zone-1/email/routing/rules", () => [
        {
          id: "r2", name: "zeta@outofscope.party", enabled: true,
          matchers: [{ type: "literal", field: "to", value: "zeta@outofscope.party" }],
          actions: [{ type: "worker", value: ["mailbox-mcp-email-worker"] }],
        },
        {
          id: "r1", name: "alpha@outofscope.party", enabled: true,
          matchers: [{ type: "literal", field: "to", value: "alpha@outofscope.party" }],
          actions: [{ type: "worker", value: ["mailbox-mcp-email-worker"] }],
        },
        {
          // A forwarding rule is not a mailbox and must not be listed.
          id: "rx", name: "forward", enabled: true,
          matchers: [{ type: "literal", field: "to", value: "other@outofscope.party" }],
          actions: [{ type: "forward", value: ["someone@example.com"] }],
        },
      ]),
    ]);

    const { isError, text } = await callTool(5, "list_mailboxes", {});
    expect(isError).toBe(false);
    const out = JSON.parse(text);
    expect(out.mailboxes.map((m: { address: string }) => m.address))
      .toEqual(["alpha@outofscope.party", "zeta@outofscope.party"]);
  });
});

describe("delete_mailbox", () => {
  const existingRule = {
    id: "r1", name: "alpha@outofscope.party", enabled: true,
    matchers: [{ type: "literal", field: "to", value: "alpha@outofscope.party" }],
    actions: [{ type: "worker", value: ["mailbox-mcp-email-worker"] }],
  };

  it("deletes the mailbox's rule", async () => {
    const { calls } = mockCloudflare([
      zoneRoute,
      rulesRoute((m, p) => m === "GET" && p === "/client/v4/zones/zone-1/email/routing/rules", () => [existingRule]),
      rulesRoute((m, p) => m === "DELETE" && p === "/client/v4/zones/zone-1/email/routing/rules/r1", () => ({})),
    ]);

    const { isError, text } = await callTool(6, "delete_mailbox", { address: "alpha@outofscope.party" });
    expect(isError).toBe(false);
    expect(JSON.parse(text)).toEqual({ address: "alpha@outofscope.party", rule_id: "r1", deleted: true });
    expect(calls.find((c) => c.method === "DELETE")?.url).toBe("/client/v4/zones/zone-1/email/routing/rules/r1");
  });

  it("404s mailboxes that do not exist", async () => {
    mockCloudflare([
      zoneRoute,
      rulesRoute((m, p) => m === "GET" && p === "/client/v4/zones/zone-1/email/routing/rules", () => []),
    ]);

    const { isError, text } = await callTool(7, "delete_mailbox", { address: "gone@outofscope.party" });
    expect(isError).toBe(true);
    expect(text).toContain('mailbox "gone@outofscope.party" not found');
  });
});

describe("enable_mailbox and disable_mailbox", () => {
  const existingRule = {
    id: "r1", name: "alpha@outofscope.party", enabled: true,
    matchers: [{ type: "literal", field: "to", value: "alpha@outofscope.party" }],
    actions: [{ type: "worker", value: ["mailbox-mcp-email-worker"] }],
  };

  it("writes the full rule back with only the enabled flag changed", async () => {
    const { calls } = mockCloudflare([
      zoneRoute,
      rulesRoute((m, p) => m === "GET" && p === "/client/v4/zones/zone-1/email/routing/rules", () => [existingRule]),
      rulesRoute((m, p) => m === "GET" && p === "/client/v4/zones/zone-1/email/routing/rules/r1", () => existingRule),
      rulesRoute((m, p) => m === "PUT" && p === "/client/v4/zones/zone-1/email/routing/rules/r1", () => existingRule),
    ]);

    const disable = await callTool(8, "disable_mailbox", { address: "alpha@outofscope.party" });
    expect(disable.isError).toBe(false);
    expect(JSON.parse(disable.text)).toEqual({ address: "alpha@outofscope.party", rule_id: "r1", enabled: false });

    const put = calls.find((c) => c.method === "PUT");
    expect(put?.body).toEqual({ ...existingRule, enabled: false });

    const enable = await callTool(9, "enable_mailbox", { address: "alpha@outofscope.party" });
    expect(enable.isError).toBe(false);
    expect(JSON.parse(enable.text).enabled).toBe(true);
  });

  it("404 unknown mailboxes", async () => {
    mockCloudflare([
      zoneRoute,
      rulesRoute((m, p) => m === "GET" && p === "/client/v4/zones/zone-1/email/routing/rules", () => []),
    ]);

    const disable = await callTool(10, "disable_mailbox", { address: "gone@outofscope.party" });
    expect(disable.isError).toBe(true);
    expect(disable.text).toContain("not found");
  });
});