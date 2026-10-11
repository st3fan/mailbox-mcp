// Mailbox tools: creating, listing, and deleting Email Routing rules that
// route mail to the configured Email Worker. Ported from the Go
// internal/mailboxes/mailboxes.go: same behavior, including local address
// validation before any API call, only-managed-rules listings, and the
// retry-on-conflict random creation.

import { z } from "zod";

import {
  createMailboxRule,
  deleteRule,
  isDuplicateAddressError,
  listRules,
  resetZoneCache,
  resolveZone,
  updateRuleStatus,
  type Rule,
} from "./cloudflare";
import type { Env } from "./env";
import { randomAddress } from "./names";
import { validateAddress } from "./validation";
import type { McpServer } from "@modelcontextprotocol/server";

/** maxRandomCreateAttempts is how often create_random_mailbox retries with a
 * new random name when Cloudflare reports the address already exists. */
const MAX_RANDOM_CREATE_ATTEMPTS = 3;

interface Mailbox {
  address: string;
  rule_id: string;
  enabled: boolean;
}

/** text wraps a value as a single JSON text content block. */
function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

/** mailboxAddress returns the mailbox address of a rule if the rule is a
 * mailbox rule: a literal "to" matcher routed to the given worker. Returns
 * null for every other kind of rule, so other routing rules on the domain
 * (forwarding rules, catch-alls) are never mistaken for mailboxes. */
function mailboxAddress(rule: Rule, worker: string): string | null {
  if (!rule.actions.some((a) => a.type === "worker" && a.value.includes(worker))) {
    return null;
  }
  for (const m of rule.matchers) {
    if (m.type === "literal" && m.field === "to" && m.value !== "") {
      return m.value;
    }
  }
  return null;
}

/** requireMailboxRule finds the managed rule for the given address or throws
 * a not-found error. */
async function requireMailboxRule(env: Env, zoneID: string, mailbox: string): Promise<Rule> {
  const rules = await listRules(env, zoneID);
  for (const rule of rules) {
    if (mailboxAddress(rule, env.EMAIL_WORKER)?.toLowerCase() === mailbox.toLowerCase()) {
      return rule;
    }
  }
  throw new Error(`mailbox "${mailbox}" not found`);
}

/** setMailboxEnabled flips the enabled flag of the mailbox's rule. */
async function setMailboxEnabled(env: Env, mailbox: string, enabled: boolean) {
  const zoneID = await resolveZone(env);
  const rule = await requireMailboxRule(env, zoneID, mailbox);
  await updateRuleStatus(env, zoneID, rule.id, enabled);
  return text({ address: mailbox, rule_id: rule.id, enabled });
}

/** registerMailboxTools registers the six mailbox tools on the server. */
export function registerMailboxTools(server: McpServer, env: Env): void {
  server.registerTool(
    "create_mailbox",
    {
      description: `Create a mailbox on ${env.DOMAIN}: an email address that receives mail routed to the ${env.EMAIL_WORKER} worker.`,
      inputSchema: {
        address: z.string().describe("the mailbox address to create, local@domain"),
      },
    },
    async ({ address }) => {
      const mailbox = validateAddress(address, env);
      const rule = await createMailboxRule(env, await resolveZone(env), mailbox, env.EMAIL_WORKER);
      return text({ address: mailbox, rule_id: rule.id, enabled: rule.enabled });
    },
  );

  server.registerTool(
    "create_random_mailbox",
    {
      description: `Create a mailbox on ${env.DOMAIN} with a random name like first.last@domain, routed to the ${env.EMAIL_WORKER} worker.`,
      inputSchema: {},
    },
    async () => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < MAX_RANDOM_CREATE_ATTEMPTS; attempt++) {
        const address = randomAddress(env.DOMAIN);
        try {
          const rule = await createMailboxRule(env, await resolveZone(env), address, env.EMAIL_WORKER);
          return text({ address, rule_id: rule.id, enabled: rule.enabled });
        } catch (err) {
          if (isDuplicateAddressError(err)) {
            lastError = err;
            continue;
          }
          throw err;
        }
      }
      throw new Error(`no unique random mailbox after ${MAX_RANDOM_CREATE_ATTEMPTS} attempts: ${String(lastError)}`);
    },
  );

  server.registerTool(
    "list_mailboxes",
    {
      description: `List the mailboxes that exist on ${env.DOMAIN}. Only mailboxes managed by mailbox-mcp are listed, not other routing rules on the domain.`,
      inputSchema: {},
    },
    async () => {
      const rules = await listRules(env, await resolveZone(env));
      const boxes: Mailbox[] = [];
      for (const rule of rules) {
        const address = mailboxAddress(rule, env.EMAIL_WORKER);
        if (address !== null) {
          boxes.push({ address, rule_id: rule.id, enabled: rule.enabled });
        }
      }
      boxes.sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
      return text({ mailboxes: boxes });
    },
  );

  server.registerTool(
    "delete_mailbox",
    {
      description: `Delete a mailbox on ${env.DOMAIN}. Permanent: the mailbox and all its mail are gone.`,
      inputSchema: {
        address: z.string().describe("the mailbox address to delete"),
      },
    },
    async ({ address }) => {
      const mailbox = validateAddress(address, env);
      const zoneID = await resolveZone(env);
      const rule = await requireMailboxRule(env, zoneID, mailbox);
      await deleteRule(env, zoneID, rule.id);
      return text({ address: mailbox, rule_id: rule.id, deleted: true });
    },
  );

  server.registerTool(
    "enable_mailbox",
    {
      description: `Enable a mailbox on ${env.DOMAIN}: mail to the address is routed to the ${env.EMAIL_WORKER} worker again.`,
      inputSchema: {
        address: z.string().describe("the mailbox address to enable"),
      },
    },
    async ({ address }) => {
      const mailbox = validateAddress(address, env);
      return setMailboxEnabled(env, mailbox, true);
    },
  );

  server.registerTool(
    "disable_mailbox",
    {
      description: `Disable a mailbox on ${env.DOMAIN}: the mailbox keeps existing but mail to the address is no longer routed to the ${env.EMAIL_WORKER} worker.`,
      inputSchema: {
        address: z.string().describe("the mailbox address to disable"),
      },
    },
    async ({ address }) => {
      const mailbox = validateAddress(address, env);
      return setMailboxEnabled(env, mailbox, false);
    },
  );
}

/** resetZoneCacheForTests drops the cached zone ID between tests. */
export function resetZoneCacheForTests(): void {
  resetZoneCache();
}