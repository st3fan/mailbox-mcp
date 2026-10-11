// An in-memory D1 binding stub covering exactly the mailbox-registry SQL the
// registry module issues: INSERT, SELECT (one/all), UPDATE, DELETE — with a
// PRIMARY KEY conflict throwing like real SQLite does. A lookupFails flag
// simulates registry outages (used by the email handler's deferral test).
export class FakeD1 {
  rows = new Map<string, { enabled: number; created_at: string }>();
  statements: string[] = [];
  lookupFails = false;

  prepare(sql: string) {
    // Both direct calls (no params) and .bind(...) chains are supported, so
    // unparameterized statements like SELECT ... ORDER BY address work too.
    const make = (params: unknown[]) => this.exec(sql, params);
    const unbound = make([]);
    return {
      bind: (...params: unknown[]) => make(params),
      first: unbound.first,
      all: unbound.all,
      run: unbound.run,
    };
  }

  private exec(sql: string, params: unknown[]) {
    const self = this;
    return {
      async first<T>(): Promise<T | null> {
        if (self.lookupFails) {
          throw new Error("registry unavailable");
        }
        if (sql.includes("FROM mailboxes WHERE address = ?")) {
          const row = self.rows.get(params[0] as string);
          return (row ? { address: params[0], ...row } : null) as T | null;
        }
        throw new Error("FakeD1: unhandled first() statement: " + sql);
      },
      async all<T>(): Promise<{ results: T[] }> {
        if (sql.includes("FROM mailboxes ORDER BY address")) {
          const results = [...self.rows.entries()]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([address, row]) => ({ address, ...row }));
          return { results } as { results: T[] };
        }
        throw new Error("FakeD1: unhandled all() statement: " + sql);
      },
      async run(): Promise<D1Result> {
        if (sql.startsWith("INSERT INTO mailboxes")) {
          // VALUES (?, 1, ?) — the enabled literal is in the SQL, so the
          // bound params are [address, created_at].
          const address = params[0] as string;
          const created_at = params[1] as string;
          if (self.rows.has(address)) {
            throw new Error(`UNIQUE constraint failed: mailboxes.address (${address})`);
          }
          self.rows.set(address, { enabled: 1, created_at });
          return { success: true, meta: { changes: 1 } } as D1Result;
        }
        if (sql.startsWith("UPDATE mailboxes SET enabled")) {
          const [enabled, address] = params as [number, string];
          const row = self.rows.get(address);
          if (!row) {
            return { success: true, meta: { changes: 0 } } as D1Result;
          }
          row.enabled = enabled as number;
          return { success: true, meta: { changes: 1 } } as D1Result;
        }
        if (sql.startsWith("DELETE FROM mailboxes")) {
          const address = params[0] as string;
          const changes = self.rows.delete(address) ? 1 : 0;
          return { success: true, meta: { changes } } as D1Result;
        }
        throw new Error("FakeD1: unhandled run() statement: " + sql);
      },
    };
  }
}