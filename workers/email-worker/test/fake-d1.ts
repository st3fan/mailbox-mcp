// An in-memory D1 binding stub covering the registry lookup the email worker
// makes (SELECT address, enabled, created_at WHERE address = ?). Registry
// failures can be simulated by making lookup throw.
export class FakeD1 {
  rows = new Map<string, { enabled: number; created_at: string }>();
  lookupFails = false;

  prepare(sql: string) {
    const self = this;
    return {
      bind: (...params: unknown[]) => ({
        async first<T>(): Promise<T | null> {
          if (self.lookupFails) {
            throw new Error("registry unavailable");
          }
          const address = params[0] as string;
          const row = self.rows.get(address);
          return (row ? { address, ...row } : null) as T | null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          throw new Error("FakeD1: unhandled all() statement: " + sql);
        },
        async run(): Promise<D1Result> {
          throw new Error("FakeD1: unhandled run() statement: " + sql);
        },
      }),
    };
  }
}