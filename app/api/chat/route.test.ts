import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
  session:
    | {
        session_id: string;
        condition: "vanilla_search" | "injected_search" | "vanilla_agent" | "injected_agent";
        topic_id: string;
        matched_topic_id: string | null;
      }
    | null;
  sessionErr: { message: string } | null;
  chatRows: Array<{ role: "user" | "assistant"; content: string; turn_number: number }>;
  insertedRows: Array<Record<string, unknown>>;
  openAiTokens: string[];
} = {
  session: null,
  sessionErr: null,
  chatRows: [],
  insertedRows: [],
  openAiTokens: [],
};

vi.mock("openai", () => {
  class OpenAIMock {
    chat = {
      completions: {
        create: async () => ({
          async *[Symbol.asyncIterator]() {
            for (const t of state.openAiTokens) {
              yield { choices: [{ delta: { content: t } }] };
            }
          },
        }),
      },
    };
    constructor(_opts: unknown) {}
  }
  return { default: OpenAIMock };
});

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => {
          if (table === "sessions") {
            return {
              maybeSingle: async () => ({ data: state.session, error: state.sessionErr }),
            };
          }
          if (table === "chat_messages") {
            return Promise.resolve({
              data: state.chatRows.map((r) => ({ role: r.role, content: r.content, turn_number: r.turn_number })),
              error: null,
            });
          }
          return Promise.resolve({ data: [], error: null });
        },
      }),
      insert: async (row: Record<string, unknown>) => {
        if (table === "chat_messages") {
          state.insertedRows.push(row);
          if ((row.role === "user" || row.role === "assistant") && typeof row.content === "string") {
            state.chatRows.push({
              role: row.role as "user" | "assistant",
              content: row.content,
              turn_number: Number(row.turn_number ?? 0),
            });
          }
        }
        return { data: null, error: null };
      },
    }),
  }),
}));

vi.mock("@/lib/config", () => ({
  getAppConfig: vi.fn(async () => ({
    chat_model: "gpt-4o-mini",
    chat_temperature: 0.3,
    chat_max_tokens: 128,
    embedding_model: "text-embedding-3-small",
  })),
}));

vi.mock("@/lib/corpus", () => ({
  loadCorpus: vi.fn(async () => ({
    version: "v",
    embedding_model: "m",
    topics: [
      {
        topic_id: "topic-match",
        topic_text: "x",
        topic_embedding: [1],
        vanilla_timeline: {
          steps: [],
          report_tokens: ["# Report\n", "vanilla"],
          citations: [],
        },
        injected_timeline: {
          steps: [{ t_ms: 0, type: "source_found", title: "M", url: "/ext/t/m", snippet: "s" }],
          report_tokens: ["# Report\n", "injected"],
          citations: [],
        },
        malicious_source: {
          title: "m",
          url_slug: "m",
          displayed_url: "d",
          snippet: "s",
          landing_markdown: "x",
        },
      },
    ],
  })),
}));

vi.mock("@/lib/events", () => ({
  logEvent: vi.fn(async () => {}),
}));

function req(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.session = {
    session_id: "sess-1",
    condition: "injected_agent",
    topic_id: "topic-a",
    matched_topic_id: "topic-match",
  };
  state.sessionErr = null;
  state.chatRows = [];
  state.insertedRows = [];
  state.openAiTokens = ["Hello", " world"];
  process.env.OPENAI_API_KEY = "test-key";
});

describe("POST /api/chat", () => {
  it("streams assistant tokens and persists both user + assistant turns", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ session_id: "sess-1", user_message: "hi there" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain('event: token');
    expect(text).toContain('"token":"Hello"');
    expect(text).toContain('"token":" world"');
    expect(text).toContain('event: done');

    expect(state.insertedRows.length).toBeGreaterThanOrEqual(2);
    const user = state.insertedRows.find((r) => r.role === "user");
    const assistant = state.insertedRows.find((r) => r.role === "assistant");
    expect(user?.content).toBe("hi there");
    expect(assistant?.content).toBe("Hello world");
    expect(user?.is_malicious_context).toBe(true);
    expect(assistant?.is_malicious_context).toBe(true);
  });

  it("rejects invalid body", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ session_id: "sess-1", user_message: "   " }));
    expect(res.status).toBe(400);
  });
});
