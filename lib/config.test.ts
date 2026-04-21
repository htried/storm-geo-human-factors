import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Silence the intentional observability console.warn emitted on the fallback path.
const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

type MockRow = {
  chat_model: string;
  chat_temperature: number;
  chat_max_tokens: number;
  embedding_model: string;
};

type QueryOutcome = { data: MockRow | null; error: { message: string } | null };

const state: {
  nextOutcome: QueryOutcome;
  callCount: number;
} = {
  nextOutcome: { data: null, error: null },
  callCount: 0,
};

/* eslint-disable @typescript-eslint/no-unused-vars */
vi.mock("./supabase", () => ({
  getSupabase: () => ({
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: number) => ({
          maybeSingle: async () => {
            state.callCount += 1;
            return state.nextOutcome;
          },
        }),
      }),
    }),
  }),
}));
/* eslint-enable @typescript-eslint/no-unused-vars */

const TEST_ENV = {
  SERPER_API_KEY: "x",
  OPENAI_API_KEY: "x",
  SUPABASE_URL: "http://x.local",
  SUPABASE_SERVICE_ROLE_KEY: "x",
  ASSIGN_SECRET: "xxxxxxxx",
  INJECT_SECRET: "xxxxxxxx",
  ADMIN_TOKEN: "xxxxxxxx",
  IP_HASH_SALT: "xxxxxxxx",
  ALLOWED_FRAME_ANCESTORS: "*",
};

describe("getAppConfig", () => {
  const orig = { ...process.env };

  beforeEach(async () => {
    process.env = { ...orig, ...TEST_ENV };
    const { __resetEnvForTest } = await import("./env");
    __resetEnvForTest();
    const { __resetAppConfigForTest } = await import("./config");
    __resetAppConfigForTest();
    state.callCount = 0;
    state.nextOutcome = { data: null, error: null };
    warnSpy.mockClear();
  });

  afterEach(() => {
    process.env = orig;
  });

  it("returns DB row when present", async () => {
    state.nextOutcome = {
      data: {
        chat_model: "gpt-5",
        chat_temperature: 0.7,
        chat_max_tokens: 1234,
        embedding_model: "text-embedding-3-large",
      },
      error: null,
    };
    const { getAppConfig } = await import("./config");
    const cfg = await getAppConfig();
    expect(cfg.chat_model).toBe("gpt-5");
    expect(cfg.chat_temperature).toBe(0.7);
    expect(cfg.chat_max_tokens).toBe(1234);
    expect(cfg.embedding_model).toBe("text-embedding-3-large");
  });

  it("falls back to env defaults when DB row missing", async () => {
    state.nextOutcome = { data: null, error: null };
    const { getAppConfig } = await import("./config");
    const cfg = await getAppConfig();
    expect(cfg.chat_model).toBe("gpt-4o-mini");
    expect(cfg.chat_temperature).toBeCloseTo(0.3);
    expect(cfg.chat_max_tokens).toBe(800);
    expect(cfg.embedding_model).toBe("text-embedding-3-small");
  });

  it("caches within the TTL and does not re-query", async () => {
    state.nextOutcome = {
      data: {
        chat_model: "gpt-x",
        chat_temperature: 0.1,
        chat_max_tokens: 100,
        embedding_model: "em-x",
      },
      error: null,
    };
    const { getAppConfig } = await import("./config");
    await getAppConfig();
    await getAppConfig();
    await getAppConfig();
    expect(state.callCount).toBe(1);
  });

  it("re-queries after cache TTL expires", async () => {
    vi.useFakeTimers();
    try {
      state.nextOutcome = {
        data: {
          chat_model: "v1",
          chat_temperature: 0.1,
          chat_max_tokens: 100,
          embedding_model: "e1",
        },
        error: null,
      };
      const { getAppConfig } = await import("./config");
      const first = await getAppConfig();
      expect(first.chat_model).toBe("v1");

      vi.advanceTimersByTime(31_000);

      state.nextOutcome = {
        data: {
          chat_model: "v2",
          chat_temperature: 0.2,
          chat_max_tokens: 200,
          embedding_model: "e2",
        },
        error: null,
      };
      const second = await getAppConfig();
      expect(second.chat_model).toBe("v2");
      expect(state.callCount).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to env defaults on DB error and logs a warning", async () => {
    state.nextOutcome = { data: null, error: { message: "boom" } };
    const { getAppConfig } = await import("./config");
    const cfg = await getAppConfig();
    expect(cfg.chat_model).toBe("gpt-4o-mini");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("boom"),
    );
  });

  it("caches the fallback value (does not re-hit DB after error)", async () => {
    state.nextOutcome = { data: null, error: { message: "boom" } };
    const { getAppConfig } = await import("./config");
    await getAppConfig();
    await getAppConfig();
    await getAppConfig();
    expect(state.callCount).toBe(1);
  });

  it("dedupes concurrent cold-cache callers into a single DB call", async () => {
    state.nextOutcome = {
      data: {
        chat_model: "gpt-x",
        chat_temperature: 0.5,
        chat_max_tokens: 500,
        embedding_model: "em",
      },
      error: null,
    };
    const { getAppConfig } = await import("./config");
    const results = await Promise.all([
      getAppConfig(),
      getAppConfig(),
      getAppConfig(),
      getAppConfig(),
    ]);
    expect(state.callCount).toBe(1);
    for (const r of results) expect(r.chat_model).toBe("gpt-x");
  });
});
