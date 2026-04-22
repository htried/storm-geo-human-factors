import { describe, it, expect, vi, beforeEach } from "vitest";

type Call = { op: string; table: string; args?: unknown; opts?: unknown };

const state: {
  // First .from("sessions").select().eq().maybeSingle() call
  existingSession: Record<string, unknown> | null;
  // Second (race re-read) .from("sessions").select().eq().maybeSingle() call
  reReadSession: Record<string, unknown> | null;
  // Rows returned from .from("sessions").upsert(...).select()
  upsertedSessions: Array<Record<string, unknown>> | null;
  upsertSessionError: { message: string } | null;
  upsertParticipantError: { message: string } | null;
  lookupError: { message: string } | null;
  reReadError: { message: string } | null;
  calls: Call[];
} = {
  existingSession: null,
  reReadSession: null,
  upsertedSessions: null,
  upsertSessionError: null,
  upsertParticipantError: null,
  lookupError: null,
  reReadError: null,
  calls: [],
};

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          maybeSingle: async () => {
            state.calls.push({ op: "select.eq.maybeSingle", table });
            if (table !== "sessions") {
              return { data: null, error: null };
            }
            const prior = state.calls.filter(
              (c) =>
                c.op === "select.eq.maybeSingle" && c.table === "sessions",
            ).length;
            if (prior > 1 && (state.reReadSession || state.reReadError)) {
              return { data: state.reReadSession, error: state.reReadError };
            }
            return { data: state.existingSession, error: state.lookupError };
          },
        }),
      }),
      upsert: (row: unknown, opts?: unknown) => {
        state.calls.push({ op: "upsert", table, args: row, opts });
        if (table === "participants") {
          return Promise.resolve({ error: state.upsertParticipantError });
        }
        // sessions: chained with .select() returning an array of rows
        return {
          select: () =>
            Promise.resolve({
              data: state.upsertedSessions,
              error: state.upsertSessionError,
            }),
        };
      },
    }),
  }),
}));

const FAKE_CORPUS = {
  version: "test",
  embedding_model: "text-embedding-3-small",
  topics: [
    {
      topic_id: "topic-a",
      topic_text: "Topic A prompt",
      topic_embedding: [1, 0, 0],
      vanilla_timeline: { steps: [], report_tokens: [], citations: [] },
      injected_timeline: { steps: [], report_tokens: [], citations: [] },
      malicious_source: {
        title: "",
        url_slug: "",
        displayed_url: "",
        snippet: "",
        landing_markdown: "",
      },
    },
    {
      topic_id: "topic-b",
      topic_text: "Topic B prompt",
      topic_embedding: [0, 1, 0],
      vanilla_timeline: { steps: [], report_tokens: [], citations: [] },
      injected_timeline: { steps: [], report_tokens: [], citations: [] },
      malicious_source: {
        title: "",
        url_slug: "",
        displayed_url: "",
        snippet: "",
        landing_markdown: "",
      },
    },
  ],
};

vi.mock("@/lib/corpus", () => ({
  loadCorpus: async () => FAKE_CORPUS,
}));

vi.mock("@/lib/config", () => ({
  getAppConfig: async () => ({
    chat_model: "gpt-4o-mini",
    chat_temperature: 0.3,
    chat_max_tokens: 800,
    embedding_model: "text-embedding-3-small",
  }),
}));

const TEST_ENV = {
  SERPER_API_KEY: "x",
  OPENAI_API_KEY: "x",
  SUPABASE_URL: "http://x.local",
  SUPABASE_SERVICE_ROLE_KEY: "x",
  ASSIGN_SECRET: "assign-secret-long",
  INJECT_SECRET: "inject-secret-long",
  ADMIN_TOKEN: "admin-token-12345",
  IP_HASH_SALT: "ip-hash-salt-long",
  ALLOWED_FRAME_ANCESTORS: "*",
};

const origEnv = { ...process.env };

beforeEach(async () => {
  process.env = { ...origEnv, ...TEST_ENV };
  const { __resetEnvForTest } = await import("@/lib/env");
  __resetEnvForTest();
  state.existingSession = null;
  state.reReadSession = null;
  state.upsertedSessions = null;
  state.upsertSessionError = null;
  state.upsertParticipantError = null;
  state.lookupError = null;
  state.reReadError = null;
  state.calls = [];
});

async function callPOST(
  body: unknown,
  headers: Record<string, string> = {},
  query: string = "",
): Promise<Response> {
  const { POST } = await import("./route");
  const qs = query ? `?${query}` : "";
  const req = new Request("http://test.local/api/session", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  // Request URL is immutable, so rebuild with query params when needed.
  const reqWithQuery =
    qs.length > 0
      ? new Request(`http://test.local/api/session${qs}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
      })
      : req;
  return POST(reqWithQuery);
}

describe("POST /api/session", () => {
  it("creates a new session with HMAC-assigned condition", async () => {
    state.upsertedSessions = [
      {
        session_id: "00000000-0000-0000-0000-000000000001",
        condition: "vanilla_search",
        topic_id: "topic-a",
      },
    ];
    const res = await callPOST({
      participant_id: "p-new",
      topic_id: "topic-a",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session_id).toBe("00000000-0000-0000-0000-000000000001");
    expect(body.topic_id).toBe("topic-a");
    expect(body.topic_text).toBe("Topic A prompt");
    expect([
      "vanilla_search",
      "injected_search",
      "vanilla_agent",
      "injected_agent",
    ]).toContain(body.condition);

    const upsertSession = state.calls.find(
      (c) => c.op === "upsert" && c.table === "sessions",
    );
    expect(upsertSession).toBeDefined();
    const row = upsertSession!.args as Record<string, unknown>;
    expect(row.assigned_by).toBe("hash");
    expect(row.chat_model_used).toBe("gpt-4o-mini");
    expect(row.chat_temperature_used).toBe(0.3);
    expect(row.embedding_model_used).toBe("text-embedding-3-small");
    expect(row.participant_id).toBe("p-new");
    expect(upsertSession!.opts).toMatchObject({
      onConflict: "participant_id",
      ignoreDuplicates: true,
    });
  });

  it("is idempotent: returns existing session for a known participant", async () => {
    state.existingSession = {
      session_id: "11111111-1111-1111-1111-111111111111",
      condition: "injected_agent",
      topic_id: "topic-b",
      participant_id: "p-existing",
    };
    const res = await callPOST({ participant_id: "p-existing" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(body.condition).toBe("injected_agent");
    expect(body.topic_id).toBe("topic-b");
    expect(body.topic_text).toBe("Topic B prompt");

    const upserts = state.calls.filter((c) => c.op === "upsert");
    expect(upserts).toHaveLength(0);
  });

  it("on a lost create race (upsert returns empty rows), re-reads and returns the winning row", async () => {
    state.existingSession = null;
    state.upsertedSessions = []; // ignoreDuplicates returns no rows on conflict
    state.reReadSession = {
      session_id: "99999999-9999-9999-9999-999999999999",
      condition: "vanilla_search",
      topic_id: "topic-b",
      participant_id: "p-race",
    };
    const res = await callPOST({
      participant_id: "p-race",
      topic_id: "topic-a",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session_id).toBe("99999999-9999-9999-9999-999999999999");
    expect(body.condition).toBe("vanilla_search");
    expect(body.topic_id).toBe("topic-b");
    expect(body.topic_text).toBe("Topic B prompt");

    const sessionSelects = state.calls.filter(
      (c) => c.op === "select.eq.maybeSingle" && c.table === "sessions",
    );
    expect(sessionSelects.length).toBe(2);
  });

  it("rejects condition_override without an admin token (403)", async () => {
    const res = await callPOST({
      participant_id: "p-evil",
      condition_override: "injected_agent",
    });
    expect(res.status).toBe(403);
    const upserts = state.calls.filter(
      (c) => c.op === "upsert" && c.table === "sessions",
    );
    expect(upserts).toHaveLength(0);
  });

  it("rejects condition_override with a wrong admin token (403)", async () => {
    const res = await callPOST(
      { participant_id: "p-evil", condition_override: "injected_agent" },
      { authorization: "Bearer wrong-token" },
    );
    expect(res.status).toBe(403);
  });

  it("accepts condition_override with the correct admin token and sets assigned_by=researcher_override", async () => {
    state.upsertedSessions = [
      {
        session_id: "22222222-2222-2222-2222-222222222222",
        condition: "injected_agent",
        topic_id: "topic-a",
      },
    ];
    const res = await callPOST(
      {
        participant_id: "p-researcher",
        topic_id: "topic-a",
        condition_override: "injected_agent",
      },
      { authorization: "Bearer admin-token-12345" },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.condition).toBe("injected_agent");
    const upsertSession = state.calls.find(
      (c) => c.op === "upsert" && c.table === "sessions",
    );
    expect(upsertSession).toBeDefined();
    const row = upsertSession!.args as Record<string, unknown>;
    expect(row.assigned_by).toBe("researcher_override");
    expect(row.condition).toBe("injected_agent");
  });

  it("accepts condition_override with a valid signed preview token query param", async () => {
    state.upsertedSessions = [
      {
        session_id: "44444444-4444-4444-4444-444444444444",
        condition: "injected_search",
        topic_id: "topic-a",
      },
    ];
    const { createPreviewToken } = await import("@/lib/preview-token");
    const token = createPreviewToken({
      participantId: "p-signed",
      condition: "injected_search",
      secret: TEST_ENV.ADMIN_TOKEN,
      expiresAtUnixSec: Math.floor(Date.now() / 1000) + 60 * 60,
    });
    const res = await callPOST(
      {
        participant_id: "p-signed",
        topic_id: "topic-a",
        condition_override: "injected_search",
      },
      {},
      `token=${encodeURIComponent(token)}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.condition).toBe("injected_search");
    const upsertSession = state.calls.find(
      (c) => c.op === "upsert" && c.table === "sessions",
    );
    const row = upsertSession!.args as Record<string, unknown>;
    expect(row.assigned_by).toBe("researcher_override");
  });

  it("rejects condition_override with an invalid/expired signed preview token", async () => {
    const res = await callPOST(
      {
        participant_id: "p-bad-signed",
        condition_override: "injected_search",
      },
      {},
      "token=bad.token",
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 for missing participant_id", async () => {
    const res = await callPOST({});
    expect(res.status).toBe(400);
  });

  it("returns 400 for an unknown topic_id", async () => {
    const res = await callPOST({
      participant_id: "p-x",
      topic_id: "does-not-exist",
    });
    expect(res.status).toBe(400);
  });

  it("picks a random topic from the corpus when topic_id is omitted", async () => {
    state.upsertedSessions = [
      {
        session_id: "33333333-3333-3333-3333-333333333333",
        condition: "vanilla_search",
        topic_id: "topic-a",
      },
    ];
    const res = await callPOST({ participant_id: "p-no-topic" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(["topic-a", "topic-b"]).toContain(body.topic_id);
    expect(["Topic A prompt", "Topic B prompt"]).toContain(body.topic_text);
  });

  it("returns 400 for malformed JSON body", async () => {
    const res = await callPOST("not json at all");
    expect(res.status).toBe(400);
  });

  it("returns 500 if session upsert fails with a DB error", async () => {
    state.upsertedSessions = null;
    state.upsertSessionError = { message: "boom" };
    const res = await callPOST({
      participant_id: "p-fail",
      topic_id: "topic-a",
    });
    expect(res.status).toBe(500);
  });

  it("returns 500 when upsert returns empty rows AND re-read also fails", async () => {
    state.upsertedSessions = [];
    state.reReadSession = null;
    state.reReadError = { message: "race + db down" };
    const res = await callPOST({
      participant_id: "p-zombie",
      topic_id: "topic-a",
    });
    expect(res.status).toBe(500);
  });
});
