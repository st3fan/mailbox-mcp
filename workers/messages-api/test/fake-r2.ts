// An in-memory R2 bucket stub covering what the messages API uses, including
// list with prefix, limit, and cursor pagination.
export class FakeR2Bucket {
  objects = new Map<string, { body: ArrayBuffer; contentType?: string }>();

  async put(key: string, value: ArrayBuffer | string, options?: { httpMetadata?: { contentType?: string } }): Promise<void> {
    const body =
      typeof value === "string" ? new TextEncoder().encode(value).buffer as ArrayBuffer : value;
    this.objects.set(key, { body, contentType: options?.httpMetadata?.contentType });
  }

  async get(key: string): Promise<{
    body: ArrayBuffer;
    contentType?: string;
    json: <T>() => Promise<T>;
    text: () => Promise<string>;
  } | null> {
    const obj = this.objects.get(key);
    if (obj === undefined) {
      return null;
    }
    const text = new TextDecoder().decode(obj.body);
    return {
      body: obj.body,
      contentType: obj.contentType,
      json: async <T>() => JSON.parse(text) as T,
      text: async () => text,
    };
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.objects.delete(key);
    }
  }

  async list(options: {
    prefix?: string;
    cursor?: string;
    startAfter?: string;
    limit?: number;
  }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }> {
    const all = [...this.objects.keys()].sort();
    let matched = all.filter((k) => (options.prefix ? k.startsWith(options.prefix) : true));
    if (options.startAfter !== undefined) {
      matched = matched.filter((k) => k > options.startAfter!);
    }
    const pageSize = options.limit ?? 1000;
    let start = 0;
    if (options.cursor !== undefined) {
      // Cursors are the index of the first key after the previous page.
      start = Number.parseInt(options.cursor, 10);
    }
    const slice = matched.slice(start, start + pageSize);
    const truncated = start + slice.length < matched.length;
    return {
      objects: slice.map((key) => ({ key })),
      truncated,
      cursor: truncated ? String(start + slice.length) : undefined,
    };
  }

  keys(): string[] {
    return [...this.objects.keys()];
  }
}