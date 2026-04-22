import { beforeEach, describe, expect, it, vi } from "vitest";

type SessionRow = {
  session_id: string;
  condition: string;
  topic_id: string;
};

const state: {
  session: SessionRow | null;
  sessionErr: { message: string } | null;
  updateErr: { message: string } | null;
  updatePatch: Record<string, unknown> | null;
  embedding: number[] | null;
  embeddingShouldThrow: boolean;
  loggedEvents: Array<{ type: string; payload?: Record<string, unknown> }>;
} = {
  session: null,
  sessionErr: null,
  updateErr: null,
  updatePatch: null,
  embedding: [0.2, 0.1],
  embeddingShouldThrow: false,
  loggedEvents: [],
};

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: async () => {
            if (table !== "sessions") return { data: null, error: null };
            return { data: state.session, error: state.sessionErr };
          },
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: async (_col: string, _val: string) => {
          if (table !== "sessions") return { error: null };
          state.updatePatch = patch;
          return { error: state.updateErr };
        },
      }),
    }),
  }),
}));

vi.mock("@/lib/openai", () => ({
  embedQuery: vi.fn(async () => {
    if (state.embeddingShouldThrow) throw new Error("embedding down");
    return state.embedding ?? [];
  }),
}));

vi.mock("@/lib/corpus", () => ({
  loadCorpus: vi.fn(async () => ({
    version: "test",
    embedding_model: "text-embedding-3-small",
    topics: [
      {
        topic_id: "topic-match",
        topic_text: "x",
        topic_embedding: [0.1, 0.2],
        vanilla_timeline: { steps: [], report_tokens: [], citations: [], total_duration_ms: 12_000 },
        injected_timeline: { steps: [], report_tokens: [], citations: [], total_duration_ms: 21_000 },
        malicious_source: {
          title: "a",
          url_slug: "b",
          displayed_url: "c",
          snippet: "d",
          landing_markdown: "e",
        },
      },
    ],
  })),
  findNearestTopic: vi.fn(() => ({
    topic: {
      topic_id: "topic-match",
      topic_text: "x",
      topic_embedding: [0.1, 0.2],
      vanilla_timeline: { steps: [], report_tokens: [], citations: [], total_duration_ms: 12_000 },
      injected_timeline: { steps: [], report_tokens: [], citations: [], total_duration_ms: 21_000 },
      malicious_source: {
        title: "a",
        url_slug: "b",
        displayed_url: "c",
        snippet: "d",
        landing_markdown: "e",
      },
    },
    similarity: 0.88,
  })),
}));

vi.mock("@/lib/config", () => ({
  getAppConfig: vi.fn(async () => ({
    chat_model: "gpt-4o-mini",
    chat_temperature: 0.3,
    chat_max_tokens: 800,
    embedding_model: "text-embedding-3-small",
  })),
}));

vi.mock("@/lib/events", () => ({
  logEvent: vi.fn(async (e) => {
    state.loggedEvents.push(e);
  }),
}));

function req(body: unknown): Request {
  return new Request("http://localhost/api/agent/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.session = {
    session_id: "sess-agent",
    condition: "vanilla_agent",
    topic_id: "topic-a",
  };
  state.sessionErr = null;
  state.updateErr = null;
  state.updatePatch = null;
  state.embedding = [0.2, 0.1];
  state.embeddingShouldThrow = false;
  state.loggedEvents = [];
});

describe("POST /api/agent/start", () => {
  it("happy path: embeds query, matches topic, updates session, logs event", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ session_id: "sess-agent", query: "scar treatment" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      stream_url: string;
      matched_topic_id: string;
      expected_duration_ms: number;
    };
    expect(body.stream_url).toContain("/api/agent/stream?session_id=sess-agent");
    expect(body.matched_topic_id).toBe("topic-match");
    expect(body.expected_duration_ms).toBe(12_000);
    expect(state.updatePatch).toMatchObject({
      matched_topic_id: "topic-match",
      matched_similarity: 0.88,
      embedding_model_used: "text-embedding-3-small",
    });
    expect(state.loggedEvents.some((e) => e.type === "agent_topic_matched")).toBe(true);
  });

  it("returns 400 for non-agent session conditions", async () => {
    state.session = {
      session_id: "sess-agent",
      condition: "vanilla_search",
      topic_id: "topic-a",
    };
    const { POST } = await import("./route");
    const res = await POST(req({ session_id: "sess-agent", query: "q" }));
    expect(res.status).toBe(400);
  });

  it("returns 503 when embedding fails", async () => {
    state.embeddingShouldThrow = true;
    const { POST } = await import("./route");
    const res = await POST(req({ session_id: "sess-agent", query: "q" }));
    expect(res.status).toBe(503);
  });
});
