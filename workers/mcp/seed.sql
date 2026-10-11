-- Migration helper for switching existing deployments from per-address
-- routing rules to the catch-all + registry model. Insert every mailbox that
-- currently has a routing rule, BEFORE deploying the acceptance-checking
-- email worker and configuring the catch-all rule:
--
--   npx wrangler d1 execute mailbox-mcp-registry --remote --file seed.sql
--
-- Edit the list to match the live mailboxes (one row per address):
INSERT INTO mailboxes (address) VALUES ('alice@example.com');
INSERT INTO mailboxes (address) VALUES ('bob@example.com');