// Generates and sets the MAILBOX_MCP_BEARER_TOKEN secret on first deploy,
// so `npm run deploy` is fully hands-off. Skipped in CI (secrets must be
// provided by the CI environment, never printed to logs). If the secret
// already exists, nothing happens.
//
// Runs as the last step of the deploy script; a failure here must not fail
// the deploy — the token can always be set manually with
// `wrangler secret put MAILBOX_MCP_BEARER_TOKEN`.
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const SECRET = "MAILBOX_MCP_BEARER_TOKEN";

function main() {
  if (process.env.CI) {
    console.log(`[provision-token] CI detected: skipping ${SECRET} provisioning.`);
    return;
  }

  const existing = execFileSync("npx", ["wrangler", "secret", "list"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (existing.includes(SECRET)) {
    console.log(`[provision-token] ${SECRET} is already set; nothing to do.`);
    return;
  }

  const token = randomBytes(32).toString("hex");
  execFileSync("npx", ["wrangler", "secret", "put", SECRET], {
    input: `${token}\n`,
    stdio: ["pipe", "inherit", "inherit"],
  });

  console.log("");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`  Generated ${SECRET}:`);
  console.log("");
  console.log(`  ${token}`);
  console.log("");
  console.log("  Save it now — it is not shown again. Configure your MCP");
  console.log("  client with the /mcp URL and this bearer token.");
  console.log("════════════════════════════════════════════════════════════");
}

try {
  main();
} catch (err) {
  console.warn(
    `[provision-token] Failed to provision ${SECRET} (${err.message}). ` +
      `Set it manually: npx wrangler secret put ${SECRET}`,
  );
}