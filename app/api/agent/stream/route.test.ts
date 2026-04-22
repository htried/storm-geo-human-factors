import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
  session:
    | {
        session_id: string;
        condition: string;
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
        topic_id: "topic-match",
        topic_text: "x",
        topic_embedding: [0.1, 0.2],
        vanilla_timeline: {
          total_duration_ms: 100,
          steps: [
            { t_ms: 0, type: "plan", text: "p0" },
            { t_ms: 1, type: "synthesis", text: "p1" },
          ],
          report_tokens: ["A", "B", "C"],
          citations: [],
        },
        injected_timeline: {
          total_duration_ms: 100,
          steps: [{ t_ms: 0, type: "plan", text: "inj" }],
          report_tokens: ["I"],
          citations: [],
        },
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
}));

beforeEach(() => {
  state.session = {
    session_id: "sess-agent",
    condition: "vanilla_agent",
    topic_id: "topic-a",
    matched_topic_id: "topic-match",
  };
  state.sessionErr = null;
});

describe("GET /api/agent/stream", () => {
  it("streams ready -> steps -> tokens -> done in order", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/agent/stream?session_id=sess-agent"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    const events = [...text.matchAll(/event:\s*([^\n]+)\ndata:\s*([^\n]+)\n\n/g)].map(
      (m) => ({
        event: m[1]!,
        data: JSON.parse(m[2]!),
      }),
    );
    expect(events.map((e) => e.event)).toEqual([
      "ready",
      "step",
      "step",
      "token",
      "token",
      "token",
      "done",
    ]);
    expect(events[0]!.data.steps).toBe(2);
    expect(events[1]!.data.step.t_ms).toBeLessThanOrEqual(events[2]!.data.step.t_ms);
    expect(events[3]!.data.token + events[4]!.data.token + events[5]!.data.token).toBe(
      "ABC",
    );
  });

  it("streams the built-in sample timeline when matched_topic_id is the sample id", async () => {
    state.session = {
      session_id: "sess-agent",
      condition: "injected_agent",
      topic_id: "topic-a",
      matched_topic_id: "__sample_injection_demo__",
    };
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/agent/stream?session_id=sess-agent"),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('event: token');
    expect(text).toContain("Injection");
    expect(text).toContain("Demo");
  });
});
