// Local address validation, ported from the Go mailboxes package: it runs
// before any storage or API access, so only addresses on the configured
// domain are ever touched.

import type { Env } from "./env";

/** validateAddress checks that address is a valid mailbox on the configured
 * domain and returns the canonical form (domain lowercased, local part kept
 * as typed). Throws with a clear message when invalid. */
export function validateAddress(address: string, env: Env): string {
  const trimmed = address.trim();
  if (trimmed === "") {
    throw new Error("address is required");
  }
  if (/[\s]/.test(trimmed)) {
    throw new Error(`"${trimmed}" is not a valid mailbox address: contains whitespace`);
  }
  const at = trimmed.indexOf("@");
  if (at === -1) {
    throw new Error(`"${trimmed}" is not a valid mailbox address: missing @`);
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (local === "") {
    throw new Error(`"${trimmed}" is not a valid mailbox address: missing local part`);
  }
  if (domain.includes("@")) {
    throw new Error(`"${trimmed}" is not a valid mailbox address: multiple @`);
  }
  if (domain.toLowerCase() !== env.DOMAIN.toLowerCase()) {
    throw new Error(`"${trimmed}" is not a mailbox on ${env.DOMAIN}`);
  }
  return `${local}@${domain.toLowerCase()}`;
}