-- Mailbox registry: the addresses mailbox-mcp manages. One entry per
-- mailbox; the email worker consults this table to decide whether incoming
-- mail for the domain is accepted (see workers/email-worker).
CREATE TABLE IF NOT EXISTS mailboxes (
  address TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);