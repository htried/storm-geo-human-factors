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
  corpus: {
    version: string;
    embedding_model: string;
    topics: Array<{
      topic_id: string;
      topic_group_id?: string;
      topic_text: string;
      topic_embedding: number[];
      vanilla_timeline: { steps: unknown[]; report_tokens: string[]; citations: unknown[]; total_duration_ms: number };
      injected_timeline: { steps: unknown[]; report_tokens: string[]; citations: unknown[]; total_duration_ms: number };
      malicious_source: {
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
  sessionErr: null,
  updateErr: null,
  updatePatch: null,
  embedding: [0.2, 0.1],
  embeddingShouldThrow: false,
  loggedEvents: [],
  corpus: {
    version: "test",
    embedding_model: "text-embedding-3-small",
    topics: [],
  },
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
  loadCorpus: vi.fn(async () => state.corpus),
  findNearestTopic: vi.fn((corpus) => ({
    topic: (corpus as { topics: Array<{ topic_id: string }> }).topics[0]!,
    similarity: 0.88,
  })),
  cosine: vi.fn((a: number[], b: number[]) => {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      dot += a[i]! * b[i]!;
      na += a[i]! * a[i]!;
      nb += b[i]! * b[i]!;
    }
    if (na === 0 || nb === 0) return 0;
    return dot / Math.sqrt(na * nb);
  }),
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
  delete process.env.MOCK_EXTERNAL_APIS;
  state.corpus = {
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
  };
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

  it("rejects whitespace-only query with 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ session_id: "sess-agent", query: "   " }));
    expect(res.status).toBe(400);
  });

  it("returns short sample report trigger without embedding dependency (mock mode)", async () => {
    process.env.MOCK_EXTERNAL_APIS = "1";
    state.embeddingShouldThrow = true;
    const { POST } = await import("./route");
    const res = await POST(
      req({ session_id: "sess-agent", query: "please run injection injection fake now" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      matched_topic_id: string;
      expected_duration_ms: number;
    };
    expect(body.matched_topic_id).toBe("__sample_injection_demo__");
    expect(body.expected_duration_ms).toBeGreaterThan(0);
  });

  it("selects best run within the same topic group", async () => {
    state.session = {
      session_id: "sess-agent",
      condition: "vanilla_agent",
      topic_id: "money_run_1",
    };
    state.corpus = {
      version: "test",
      embedding_model: "text-embedding-3-small",
      topics: [
        {
          topic_id: "money_run_1",
          topic_group_id: "money_topic",
          topic_text: "money topic",
          topic_embedding: [0.1, 0.2],
          vanilla_timeline: {
            steps: [],
            report_tokens: ["generic", "overview", "debt"],
            citations: [],
            total_duration_ms: 11_000,
          },
          injected_timeline: { steps: [], report_tokens: [], citations: [], total_duration_ms: 21_000 },
          malicious_source: { title: "a", url_slug: "b", displayed_url: "c", snippet: "d", landing_markdown: "e" },
        },
        {
          topic_id: "money_run_2",
          topic_group_id: "money_topic",
          topic_text: "money topic",
          topic_embedding: [0.1, 0.2],
          vanilla_timeline: {
            steps: [],
            report_tokens: ["collections", "medical", "bill", "credit", "collections"],
            citations: [],
            total_duration_ms: 9_000,
          },
          injected_timeline: { steps: [], report_tokens: [], citations: [], total_duration_ms: 19_000 },
          malicious_source: { title: "a", url_slug: "b", displayed_url: "c", snippet: "d", landing_markdown: "e" },
        },
      ],
    };
    const { POST } = await import("./route");
    const res = await POST(req({ session_id: "sess-agent", query: "medical bill collections credit impact" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { matched_topic_id: string };
    expect(body.matched_topic_id).toBe("money_run_2");
  });

  it("ignores the sample trigger phrase outside mock mode", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      req({ session_id: "sess-agent", query: "please run injection injection fake now" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { matched_topic_id: string };
    expect(body.matched_topic_id).toBe("topic-match");
  });

  it("mock mode: skips embedding and replays the assigned topic", async () => {
    process.env.MOCK_EXTERNAL_APIS = "1";
    state.session = { session_id: "sess-agent", condition: "injected_agent", topic_id: "topic-match" };
    const { embedQuery } = await import("@/lib/openai");
    const { POST } = await import("./route");
    const res = await POST(req({ session_id: "sess-agent", query: "anything" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { matched_topic_id: string; expected_duration_ms: number };
    expect(body.matched_topic_id).toBe("topic-match");
    expect(body.expected_duration_ms).toBe(21_000);
    expect(embedQuery).not.toHaveBeenCalled();
    expect(state.updatePatch).toMatchObject({
      matched_topic_id: "topic-match",
      matched_similarity: null,
      embedding_model_used: "mock",
    });
  });
});
