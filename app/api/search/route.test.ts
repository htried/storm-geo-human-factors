import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SerperSearchResult } from "@/lib/serper";

type Condition =
  | "vanilla_search"
  | "injected_search"
  | "vanilla_agent"
  | "injected_agent";

interface FakeSession {
  session_id: string;
  condition: Condition;
  topic_id: string;
}

const state: {
  session: FakeSession | null;
  sessionLookupError: { message: string } | null;
  cachedResults: SerperSearchResult[] | null;
  serperResults: SerperSearchResult[];
  serperShouldThrow: boolean;
  getCachedShouldThrow: boolean;
  setCachedShouldThrow: boolean;
  loggedEvents: Array<{ sessionId: string; type: string; payload?: Record<string, unknown> }>;
  setCachedCalls: number;
  env: {
    ADMIN_TOKEN: string;
    INJECT_SECRET: string;
  };
  corpus: {
    topics: Array<{
      topic_id: string;
      malicious_source?: {
        title: string;
        url_slug: string;
        displayed_url: string;
        snippet: string;
        landing_markdown: string;
      };
    }>;
  };
} = {
  session: null,
  sessionLookupError: null,
  cachedResults: null,
  serperResults: [],
  serperShouldThrow: false,
  getCachedShouldThrow: false,
  setCachedShouldThrow: false,
  loggedEvents: [],
  setCachedCalls: 0,
  env: {
    ADMIN_TOKEN: "admin-token-xyzzy",
    INJECT_SECRET: "inject-secret-xyzzy",
  },
  corpus: { topics: [] },
};

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: (table: string) => ({
      select: (_cols?: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: async () => {
            if (table !== "sessions") return { data: null, error: null };
            return { data: state.session, error: state.sessionLookupError };
          },
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/search_cache", () => ({
  getCached: vi.fn(async () => {
    if (state.getCachedShouldThrow) throw new Error("cache read failed");
    return state.cachedResults;
  }),
  setCached: vi.fn(async () => {
    if (state.setCachedShouldThrow) throw new Error("cache write failed");
    state.setCachedCalls++;
  }),
  cacheKey: (q: string, p: number) => `ck|${q}|${p}`,
}));

vi.mock("@/lib/serper", () => ({
  searchSerper: vi.fn(async () => {
    if (state.serperShouldThrow) throw new Error("SERPER failed");
    return { results: state.serperResults };
  }),
}));

vi.mock("@/lib/events", () => ({
  logEvents: vi.fn(async (events) => {
    for (const e of events) state.loggedEvents.push(e);
  }),
  logEvent: vi.fn(async (e) => {
    state.loggedEvents.push(e);
  }),
}));

vi.mock("@/lib/env", () => ({
  loadEnv: () => state.env,
}));

vi.mock("@/lib/corpus", () => ({
  loadCorpus: async () => state.corpus,
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.session = {
    session_id: "sess-1",
    condition: "vanilla_search",
    topic_id: "topic-a",
  };
  state.sessionLookupError = null;
  state.cachedResults = null;
  state.serperResults = [];
  state.serperShouldThrow = false;
  state.getCachedShouldThrow = false;
  state.setCachedShouldThrow = false;
  state.loggedEvents = [];
  state.setCachedCalls = 0;
  state.corpus = {
    topics: [
      {
        topic_id: "topic-a",
        malicious_source: {
          title: "The Truth About Scars",
          url_slug: "truth-about-scars",
          displayed_url: "example-health.org/truth-about-scars",
          snippet: "A landmark study on scarring you haven't been told about.",
          landing_markdown: "# Fake article\n\nBody...",
        },
      },
      {
        topic_id: "topic-no-malicious",
      },
    ],
  };
});

function makeResults(n: number): SerperSearchResult[] {
  return Array.from({ length: n }, (_, i) => ({
    title: `Result ${i}`,
    url: `https://example.com/${i}`,
    displayed_url: `example.com/${i}`,
    snippet: `Snippet ${i}`,
    rank: i,
  }));
}

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/search", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/search", () => {
  it("returns vanilla SERPER results for vanilla_search, populates cache, logs search_results_served", async () => {
    state.serperResults = makeResults(10);
    const { POST } = await import("./route");
    const res = await POST(req({ session_id: "sess-1", query: "scar types", page: 1 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: SerperSearchResult[];
      total_pages: number;
      injected_rank?: number;
    };
    expect(body.total_pages).toBe(5);
    expect(body.results.map((r) => r.url)).toEqual(
      makeResults(10).map((r) => r.url),
    );
    expect("injected_rank" in body).toBe(false);
    expect(state.setCachedCalls).toBe(1);
    const served = state.loggedEvents.find((e) => e.type === "search_results_served");
    expect(served).toBeDefined();
    expect(served!.payload).toMatchObject({
      query: "scar types",
      page: 1,
      injected_rank: null,
    });
    expect(served!.payload!.result_urls).toHaveLength(10);
  });

  it("uses cached results and does not call SERPER or re-populate cache on a hit", async () => {
    state.cachedResults = makeResults(4);
    state.serperResults = [];
    const { POST } = await import("./route");
    const { searchSerper } = await import("@/lib/serper");
    const res = await POST(req({ session_id: "sess-1", query: "q", page: 1 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: SerperSearchResult[] };
    expect(body.results).toHaveLength(4);
    expect(vi.mocked(searchSerper)).not.toHaveBeenCalled();
    expect(state.setCachedCalls).toBe(0);
  });

  it("injects the malicious source on page 1 when condition is injected_search", async () => {
    state.session = {
      session_id: "sess-1",
      condition: "injected_search",
      topic_id: "topic-a",
    };
    state.serperResults = makeResults(10);
    const { POST } = await import("./route");
    const res = await POST(req({ session_id: "sess-1", query: "scar types", page: 1 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: SerperSearchResult[];
      injected_rank?: number;
    };
    // exactly one result should point at /ext/topic-a/...
    const injected = body.results.filter((r) => r.url.startsWith("/ext/topic-a/"));
    expect(injected).toHaveLength(1);
    expect(injected[0]!.url).toBe("/ext/topic-a/truth-about-scars");
    expect(injected[0]!.title).toBe("The Truth About Scars");
    expect(injected[0]!.displayed_url).toBe(
      "example-health.org/truth-about-scars",
    );
    expect(body.results).toHaveLength(10);
    // injected_rank must NOT be exposed without the admin header
    expect("injected_rank" in body).toBe(false);
    // but it IS logged in the event payload
    const served = state.loggedEvents.find((e) => e.type === "search_results_served");
    expect(typeof served!.payload!.injected_rank).toBe("number");
  });

  it("exposes injected_rank in the response only when x-admin-token matches", async () => {
    state.session = {
      session_id: "sess-1",
      condition: "injected_search",
      topic_id: "topic-a",
    };
    state.serperResults = makeResults(5);
    const { POST } = await import("./route");
    const res = await POST(
      req(
        { session_id: "sess-1", query: "q", page: 1 },
        { "x-admin-token": "admin-token-xyzzy" },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: SerperSearchResult[];
      injected_rank?: number;
    };
    expect(typeof body.injected_rank).toBe("number");
    expect(body.injected_rank).toBeGreaterThanOrEqual(0);
    expect(body.injected_rank).toBeLessThan(body.results.length);
  });

  it("does not expose injected_rank when an incorrect admin token is sent", async () => {
    state.session = {
      session_id: "sess-1",
      condition: "injected_search",
      topic_id: "topic-a",
    };
    state.serperResults = makeResults(5);
    const { POST } = await import("./route");
    const res = await POST(
      req(
        { session_id: "sess-1", query: "q", page: 1 },
        { "x-admin-token": "wrong-token" },
      ),
    );
    const body = (await res.json()) as { injected_rank?: number };
    expect("injected_rank" in body).toBe(false);
  });

  it("never injects on page 2+", async () => {
    state.session = {
      session_id: "sess-1",
      condition: "injected_search",
      topic_id: "topic-a",
    };
    state.serperResults = makeResults(10);
    const { POST } = await import("./route");
    const res = await POST(req({ session_id: "sess-1", query: "q", page: 2 }));
    const body = (await res.json()) as { results: SerperSearchResult[] };
    expect(body.results.every((r) => !r.url.startsWith("/ext/"))).toBe(true);
    const served = state.loggedEvents.find((e) => e.type === "search_results_served");
    expect(served!.payload!.injected_rank).toBeNull();
  });

  it("returns an empty results array for zero-organic-results without fabricating injection", async () => {
    state.session = {
      session_id: "sess-1",
      condition: "injected_search",
      topic_id: "topic-a",
    };
    state.serperResults = [];
    const { POST } = await import("./route");
    const res = await POST(req({ session_id: "sess-1", query: "q", page: 1 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: SerperSearchResult[] };
    expect(body.results).toEqual([]);
    const served = state.loggedEvents.find((e) => e.type === "search_results_served");
    expect(served!.payload!.injected_rank).toBeNull();
  });

  it("fails open (no injection) when the topic has no malicious_source, logging injection_skipped", async () => {
    state.session = {
      session_id: "sess-1",
      condition: "injected_search",
      topic_id: "topic-no-malicious",
    };
    state.serperResults = makeResults(5);
    const { POST } = await import("./route");
    const res = await POST(req({ session_id: "sess-1", query: "q", page: 1 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: SerperSearchResult[] };
    expect(body.results.every((r) => !r.url.startsWith("/ext/"))).toBe(true);
    expect(state.loggedEvents.some((e) => e.type === "injection_skipped")).toBe(
      true,
    );
  });

  it("returns 502 and logs api_error on SERPER failure", async () => {
    state.serperShouldThrow = true;
    const { POST } = await import("./route");
    const res = await POST(req({ session_id: "sess-1", query: "q", page: 1 }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/search provider/i);
    expect(state.loggedEvents.some((e) => e.type === "api_error")).toBe(true);
  });

  it("returns 404 when the session is unknown", async () => {
    state.session = null;
    const { POST } = await import("./route");
    const res = await POST(req({ session_id: "sess-unknown", query: "q", page: 1 }));
    expect(res.status).toBe(404);
  });

  it("returns 400 on invalid body", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: "sess-1", query: "", page: 1 }),
      }),
    );
    expect(res.status).toBe(400);

    const res2 = await POST(req({ session_id: "sess-1", query: "q", page: 0 }));
    expect(res2.status).toBe(400);
    const res3 = await POST(req({ session_id: "sess-1", query: "q", page: 6 }));
    expect(res3.status).toBe(400);
  });

  it("returns 500 when the session lookup errors", async () => {
    state.sessionLookupError = { message: "db down" };
    const { POST } = await import("./route");
    const res = await POST(req({ session_id: "sess-1", query: "q", page: 1 }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; detail?: string };
    expect(body.error).toMatch(/failed to look up session/i);
    expect(body.detail).toBeUndefined();
  });

  it("degrades gracefully when cache read fails: logs api_error and falls through to SERPER", async () => {
    state.getCachedShouldThrow = true;
    state.serperResults = makeResults(3);
    const { POST } = await import("./route");
    const { searchSerper } = await import("@/lib/serper");
    const res = await POST(req({ session_id: "sess-1", query: "q", page: 1 }));
    expect(res.status).toBe(200);
    expect(vi.mocked(searchSerper)).toHaveBeenCalledTimes(1);
    expect(state.loggedEvents.some((e) => e.type === "api_error")).toBe(true);
    const errEvent = state.loggedEvents.find(
      (e) => e.type === "api_error" && e.payload?.where === "search_cache.get",
    );
    expect(errEvent).toBeDefined();
  });

  it("degrades gracefully when cache write fails: still returns SERPER results and logs api_error", async () => {
    state.setCachedShouldThrow = true;
    state.serperResults = makeResults(2);
    const { POST } = await import("./route");
    const res = await POST(req({ session_id: "sess-1", query: "q", page: 1 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: SerperSearchResult[] };
    expect(body.results).toHaveLength(2);
    const errEvent = state.loggedEvents.find(
      (e) => e.type === "api_error" && e.payload?.where === "search_cache.set",
    );
    expect(errEvent).toBeDefined();
  });
});
