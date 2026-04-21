import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface SelectCall {
  table: string;
  col: string;
  value: string;
  gtCol?: string;
  gtValue?: string;
  returned: unknown;
}
interface UpsertCall {
  table: string;
  row: Record<string, unknown>;
  onConflict?: string;
}

const calls: {
  selects: SelectCall[];
  upserts: UpsertCall[];
} = { selects: [], upserts: [] };

const state: {
  nextSelectReturn: unknown;
  nextSelectError: { message: string } | null;
  nextUpsertError: { message: string } | null;
} = {
  nextSelectReturn: null,
  nextSelectError: null,
  nextUpsertError: null,
};

vi.mock("./supabase", () => ({
  getSupabase: () => ({
    from: (table: string) => ({
      select: () => {
        const builder = {
          _eqCol: "",
          _eqVal: "",
          _gtCol: undefined as string | undefined,
          _gtVal: undefined as string | undefined,
          eq(col: string, value: string) {
            this._eqCol = col;
            this._eqVal = value;
            return this;
          },
          gt(col: string, value: string) {
            this._gtCol = col;
            this._gtVal = value;
            return this;
          },
          async maybeSingle() {
            calls.selects.push({
              table,
              col: this._eqCol,
              value: this._eqVal,
              gtCol: this._gtCol,
              gtValue: this._gtVal,
              returned: state.nextSelectReturn,
            });
            return { data: state.nextSelectReturn, error: state.nextSelectError };
          },
        };
        return builder;
      },
      upsert: async (
        row: Record<string, unknown>,
        opts?: { onConflict?: string },
      ) => {
        calls.upserts.push({ table, row, onConflict: opts?.onConflict });
        return { data: null, error: state.nextUpsertError };
      },
    }),
  }),
}));

beforeEach(() => {
  calls.selects.length = 0;
  calls.upserts.length = 0;
  state.nextSelectReturn = null;
  state.nextSelectError = null;
  state.nextUpsertError = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("search_cache key", () => {
  it("keys deterministically on sha256(query|page)", async () => {
    const { cacheKey } = await import("./search_cache");
    const k1 = cacheKey("hello world", 1);
    const k2 = cacheKey("hello world", 1);
    const k3 = cacheKey("hello world", 2);
    const k4 = cacheKey("HELLO WORLD", 1);
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
    expect(k1).not.toBe(k4);
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("getCached", () => {
  it("returns the cached raw_results when the row exists and is unexpired", async () => {
    state.nextSelectReturn = {
      raw_results: [{ title: "ok", url: "https://x", displayed_url: "x", snippet: "", rank: 0 }],
    };
    const { getCached, cacheKey } = await import("./search_cache");
    const out = await getCached({ query: "q", page: 1 });
    expect(out).toEqual([
      { title: "ok", url: "https://x", displayed_url: "x", snippet: "", rank: 0 },
    ]);
    expect(calls.selects).toHaveLength(1);
    const c = calls.selects[0]!;
    expect(c.table).toBe("search_cache");
    expect(c.col).toBe("cache_key");
    expect(c.value).toBe(cacheKey("q", 1));
    expect(c.gtCol).toBe("expires_at");
    expect(typeof c.gtValue).toBe("string");
  });

  it("returns null when no row is found", async () => {
    state.nextSelectReturn = null;
    const { getCached } = await import("./search_cache");
    const out = await getCached({ query: "q", page: 1 });
    expect(out).toBeNull();
  });

  it("throws when supabase returns an error", async () => {
    state.nextSelectError = { message: "db down" };
    const { getCached } = await import("./search_cache");
    await expect(getCached({ query: "q", page: 1 })).rejects.toThrow(/db down/);
  });

  it("returns null when a cached row has unexpected shape (fails validation rather than corrupting)", async () => {
    state.nextSelectReturn = { raw_results: "not an array" };
    const { getCached } = await import("./search_cache");
    const out = await getCached({ query: "q", page: 1 });
    expect(out).toBeNull();
  });
});

describe("setCached", () => {
  it("upserts on cache_key with query, page, raw_results, and expires_at", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T00:00:00Z"));

    const { setCached, cacheKey } = await import("./search_cache");
    const results = [
      { title: "t", url: "https://x", displayed_url: "x", snippet: "", rank: 0 },
    ];
    await setCached({
      query: "hello",
      page: 2,
      raw_results: results,
      ttlMs: 60_000,
    });

    expect(calls.upserts).toHaveLength(1);
    const c = calls.upserts[0]!;
    expect(c.table).toBe("search_cache");
    expect(c.onConflict).toBe("cache_key");
    expect(c.row.cache_key).toBe(cacheKey("hello", 2));
    expect(c.row.query).toBe("hello");
    expect(c.row.page).toBe(2);
    expect(c.row.raw_results).toEqual(results);
    expect(c.row.expires_at).toBe("2026-04-21T00:01:00.000Z");
  });

  it("defaults ttlMs to 24h when not provided", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T00:00:00Z"));

    const { setCached } = await import("./search_cache");
    await setCached({ query: "q", page: 1, raw_results: [] });
    const c = calls.upserts[0]!;
    expect(c.row.expires_at).toBe("2026-04-22T00:00:00.000Z");
  });

  it("throws when supabase upsert returns an error", async () => {
    state.nextUpsertError = { message: "boom" };
    const { setCached } = await import("./search_cache");
    await expect(
      setCached({ query: "q", page: 1, raw_results: [] }),
    ).rejects.toThrow(/boom/);
  });
});
