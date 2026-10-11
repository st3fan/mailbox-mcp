// Minimal client for the parts of the Cloudflare Email Routing API the
// mailbox tools need. Ported from the Go internal/cloudflare package: same
// endpoints, payloads, and error messages.

import type { Env } from "./env";

const API_BASE = "https://api.cloudflare.com/client/v4";

/** Rule is an Email Routing rule. */
export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  matchers: { type: string; field: string; value: string }[];
  actions: { type: string; value: string[] }[];
}

/** CloudflareError is an error returned by the Cloudflare API. */
export class CloudflareError extends Error {
  readonly code: number;

  constructor(code: number, message: string, method: string, path: string) {
    super(message === "" ? `${method} ${path}: HTTP error ${code}` : `cloudflare: error ${code}: ${message}`);
    this.code = code;
    this.name = "CloudflareError";
  }
}

/** isDuplicateAddressError reports whether err is Cloudflare complaining that
 * a routing rule for the address already exists. */
export function isDuplicateAddressError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  return msg.includes("already exist") || msg.includes("duplicate");
}

/** api performs one Cloudflare API call and unwraps the standard envelope. */
async function api(env: Env, method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      "authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  let envelope: { success?: boolean; errors?: { code: number; message: string }[]; result?: unknown };
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new CloudflareError(res.status, "", method, path);
  }
  if (envelope.success === false || (envelope.errors?.length ?? 0) > 0 || res.status >= 400) {
    const first = envelope.errors?.[0];
    throw new CloudflareError(first?.code ?? res.status, first?.message ?? "", method, path);
  }
  return envelope.result;
}

/** Cached zone ID: resolving the domain is one API call per isolate. */
let cachedZoneID: string | null = null;

/** resetZoneCache drops the cached zone ID; used by tests. */
export function resetZoneCache(): void {
  cachedZoneID = null;
}

/** resolveZone returns the ID of the zone with the configured domain. It is
 * resolved once per isolate and cached. */
export async function resolveZone(env: Env): Promise<string> {
  if (cachedZoneID !== null) {
    return cachedZoneID;
  }
  const zones = (await api(env, "GET", `/zones?name=${encodeURIComponent(env.DOMAIN)}`)) as { id: string; name: string }[];
  if (zones.length === 0) {
    throw new Error(`zone "${env.DOMAIN}" not found: check the domain and that the API token can see it`);
  }
  cachedZoneID = zones[0]!.id;
  return cachedZoneID;
}

/** listRules returns all Email Routing rules of the zone. */
export async function listRules(env: Env, zoneID: string): Promise<Rule[]> {
  return (await api(env, "GET", `/zones/${zoneID}/email/routing/rules`)) as Rule[];
}

/** createMailboxRule creates an Email Routing rule that routes mail for the
 * given address to the named Email Worker. */
export async function createMailboxRule(env: Env, zoneID: string, address: string, worker: string): Promise<Rule> {
  return (await api(env, "POST", `/zones/${zoneID}/email/routing/rules`, {
    name: address,
    enabled: true,
    matchers: [{ type: "literal", field: "to", value: address }],
    actions: [{ type: "worker", value: [worker] }],
  })) as Rule;
}

/** getRule returns the Email Routing rule with the given ID. */
async function getRule(env: Env, zoneID: string, ruleID: string): Promise<Rule> {
  return (await api(env, "GET", `/zones/${zoneID}/email/routing/rules/${ruleID}`)) as Rule;
}

/** deleteRule deletes the Email Routing rule with the given ID. */
export async function deleteRule(env: Env, zoneID: string, ruleID: string): Promise<void> {
  await api(env, "DELETE", `/zones/${zoneID}/email/routing/rules/${ruleID}`);
}

/** updateRuleStatus sets the enabled flag of the rule with the given ID. The
 * Cloudflare API rejects minimal patches on this endpoint, so the full rule
 * is fetched and written back with only the enabled flag changed. */
export async function updateRuleStatus(env: Env, zoneID: string, ruleID: string, enabled: boolean): Promise<void> {
  const rule = await getRule(env, zoneID, ruleID);
  rule.enabled = enabled;
  await api(env, "PUT", `/zones/${zoneID}/email/routing/rules/${ruleID}`, rule);
}