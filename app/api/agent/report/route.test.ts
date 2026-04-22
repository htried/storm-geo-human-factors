import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
  session:
    | {
        condition: "vanilla_search" | "injected_search" | "vanilla_agent" | "injected_agent";
        topic_id: string;
        matched_topic_id: string | null;
      }
    | null;
  sessionErr: { message: string } | null;
} = {
  session: null,
  sessionErr: null,
};

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: async () => ({ data: state.session, error: state.sessionErr }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/corpus", () => ({
  loadCorpus: vi.fn(async () => ({
    version: "test",
    embedding_model: "m",
    topics: [
      {
        topic_id: "topic-1",
        topic_text: "x",
        topic_embedding: [1],
        vanilla_timeline: {
          steps: [
            {
              t_ms: 1,
              type: "source_found",
              title: "V Source",
              url: "https://example.com",
              snippet: "a",
            },
          ],
          report_tokens: ["V"],
          citations: [{ n: 1, url: "https://example.com", title: "V Source" }],
        },
        injected_timeline: {
          steps: [
            {
              t_ms: 1,
              type: "source_found",
              title: "I Source",
              url: "/ext/topic-1/mal",
              snippet: "b",
            },
          ],
          report_tokens: ["I"],
          citations: [{ n: 2, url: "/ext/topic-1/mal", title: "I Source" }],
        },
        malicious_source: {
          title: "m",
          url_slug: "mal",
          displayed_url: "x",
          snippet: "y",
          landing_markdown: "z",
        },
      },
    ],
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.session = {
    condition: "injected_agent",
    topic_id: "topic-1",
    matched_topic_id: "topic-1",
  };
  state.sessionErr = null;
});

describe("GET /api/agent/report", () => {
  it("returns timeline report/citations/sources for matched topic", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/agent/report?session_id=sess-1"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      report_tokens: string[];
      citations: Array<{ n: number }>;
      sources: Array<{ is_malicious: boolean }>;
    };
    expect(body.report_tokens.join("")).toBe("I");
    expect(body.citations[0]!.n).toBe(2);
    expect(body.sources[0]!.is_malicious).toBe(true);
  });

  it("returns 400 for non-agent sessions", async () => {
    state.session = {
      condition: "vanilla_search",
      topic_id: "topic-1",
      matched_topic_id: null,
    };
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/agent/report?session_id=sess-1"),
    );
    expect(res.status).toBe(400);
  });

  it("returns built-in sample report when matched_topic_id is the sample id", async () => {
    state.session = {
      condition: "injected_agent",
      topic_id: "topic-1",
      matched_topic_id: "__sample_injection_demo__",
    };
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/agent/report?session_id=sess-1"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      report_tokens: string[];
      citations: Array<{ n: number }>;
    };
    expect(body.report_tokens.join("")).toContain("Injection Demo Report");
    expect(body.citations[0]!.n).toBe(1);
  });
});
