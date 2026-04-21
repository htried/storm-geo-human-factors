import { describe, it, expect, vi, beforeEach } from "vitest";

type Call = { op: string; table: string; args?: unknown };

const state: {
  sessionExists: boolean;
  sessionLookupError: { message: string } | null;
  insertError: { message: string } | null;
  calls: Call[];
} = {
  sessionExists: true,
  sessionLookupError: null,
  insertError: null,
  calls: [],
};

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          maybeSingle: async () => {
            state.calls.push({ op: "select.eq.maybeSingle", table });
            return {
              data: state.sessionExists ? { session_id: "s" } : null,
              error: state.sessionLookupError,
            };
          },
        }),
      }),
      insert: async (rows: unknown) => {
        state.calls.push({ op: "insert", table, args: rows });
        return { error: state.insertError };
      },
    }),
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
  state.sessionExists = true;
  state.sessionLookupError = null;
  state.insertError = null;
  state.calls = [];
});

async function callPOST(body: unknown): Promise<Response> {
  const { POST } = await import("./route");
  const req = new Request("http://test.local/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(req);
}

describe("POST /api/events", () => {
  it("inserts a valid batch in one Supabase call and returns inserted count", async () => {
    const res = await callPOST({
      session_id: "11111111-1111-1111-1111-111111111111",
      events: [
        { t_ms: 0, type: "query_submitted", payload: { query: "q" } },
        { t_ms: 100, type: "result_clicked", payload: { rank: 2 } },
        { t_ms: 200, type: "page_changed" },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inserted).toBe(3);

    const inserts = state.calls.filter(
      (c) => c.op === "insert" && c.table === "events",
    );
    expect(inserts).toHaveLength(1);
    const rows = inserts[0]!.args as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    expect(rows[0]!.session_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(rows[0]!.type).toBe("query_submitted");
    expect(rows[2]!.payload).toEqual({});
  });

  it("returns 404 when session does not exist", async () => {
    state.sessionExists = false;
    const res = await callPOST({
      session_id: "missing",
      events: [{ t_ms: 0, type: "x" }],
    });
    expect(res.status).toBe(404);
    const inserts = state.calls.filter((c) => c.op === "insert");
    expect(inserts).toHaveLength(0);
  });

  it("returns 400 for oversized batch (>100)", async () => {
    const events = Array.from({ length: 101 }, (_, i) => ({
      t_ms: i,
      type: "x",
    }));
    const res = await callPOST({ session_id: "s", events });
    expect(res.status).toBe(400);
    const inserts = state.calls.filter((c) => c.op === "insert");
    expect(inserts).toHaveLength(0);
  });

  it("accepts batch of exactly 100", async () => {
    const events = Array.from({ length: 100 }, (_, i) => ({
      t_ms: i,
      type: "x",
    }));
    const res = await callPOST({ session_id: "s", events });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inserted).toBe(100);
  });

  it("returns 200 with inserted=0 for empty batch, no DB write", async () => {
    const res = await callPOST({ session_id: "s", events: [] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inserted).toBe(0);
    const inserts = state.calls.filter((c) => c.op === "insert");
    expect(inserts).toHaveLength(0);
  });

  it("returns 400 for malformed body (missing session_id)", async () => {
    const res = await callPOST({ events: [{ t_ms: 0, type: "x" }] });
    expect(res.status).toBe(400);
  });

  it("returns 400 for malformed body (events not an array)", async () => {
    const res = await callPOST({ session_id: "s", events: "nope" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await callPOST("not json");
    expect(res.status).toBe(400);
  });

  it("returns 500 when the insert fails", async () => {
    state.insertError = { message: "boom" };
    const res = await callPOST({
      session_id: "s",
      events: [{ t_ms: 0, type: "x" }],
    });
    expect(res.status).toBe(500);
  });
});
