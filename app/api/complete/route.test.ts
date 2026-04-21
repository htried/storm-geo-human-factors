import { describe, it, expect, vi, beforeEach } from "vitest";

type Call = { op: string; table: string; args?: unknown };

const state: {
  // Returned by select().eq(session_id).maybeSingle(), and (when set) by the
  // re-read after a lost-race update.
  existingSession: Record<string, unknown> | null;
  reReadSession: Record<string, unknown> | null;
  // Result of the conditional update .update().eq().is().select().maybeSingle()
  updatedSession: Record<string, unknown> | null;
  lookupError: { message: string } | null;
  updateError: { message: string } | null;
  reReadError: { message: string } | null;
  calls: Call[];
} = {
  existingSession: null,
  reReadSession: null,
  updatedSession: null,
  lookupError: null,
  updateError: null,
  reReadError: null,
  calls: [],
};

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          maybeSingle: async () => {
            // First select() call returns existingSession; subsequent calls
            // (after a lost-race update) return reReadSession if set,
            // otherwise fall back to existingSession.
            state.calls.push({ op: "select.eq.maybeSingle", table });
            const priorSelects = state.calls.filter(
              (c) => c.op === "select.eq.maybeSingle" && c.table === table,
            ).length;
            if (priorSelects > 1 && state.reReadSession !== null) {
              return { data: state.reReadSession, error: state.reReadError };
            }
            if (priorSelects > 1 && state.reReadError) {
              return { data: null, error: state.reReadError };
            }
            return { data: state.existingSession, error: state.lookupError };
          },
        }),
      }),
      update: (patch: unknown) => {
        state.calls.push({ op: "update", table, args: patch });
        return {
          eq: (_col: string, _val: unknown) => ({
            is: (_isCol: string, _isVal: unknown) => ({
              select: (_cols: string) => ({
                maybeSingle: async () => ({
                  data: state.updatedSession,
                  error: state.updateError,
                }),
              }),
            }),
          }),
        };
      },
    }),
  }),
}));

beforeEach(() => {
  state.existingSession = null;
  state.reReadSession = null;
  state.updatedSession = null;
  state.lookupError = null;
  state.updateError = null;
  state.reReadError = null;
  state.calls = [];
});

async function callPOST(body: unknown): Promise<Response> {
  const { POST } = await import("./route");
  const req = new Request("http://test.local/api/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(req);
}

describe("POST /api/complete", () => {
  it("returns 400 for missing session_id", async () => {
    const res = await callPOST({});
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await callPOST("not json");
    expect(res.status).toBe(400);
  });

  it("returns 404 when session not found", async () => {
    state.existingSession = null;
    const res = await callPOST({ session_id: "missing" });
    expect(res.status).toBe(404);
  });

  it("generates a completion code, stamps completed_at, and returns the code", async () => {
    state.existingSession = {
      session_id: "s1",
      started_at: null,
      completed_at: null,
      completion_code: null,
    };
    state.updatedSession = {
      session_id: "s1",
      started_at: null,
      completed_at: "2026-04-21T00:00:10Z",
      completion_code: "NOTREAL1",
    };
    const res = await callPOST({ session_id: "s1" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session_id).toBe("s1");
    expect(body.completion_code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);

    const updateCall = state.calls.find((c) => c.op === "update");
    expect(updateCall).toBeDefined();
    const patch = updateCall!.args as Record<string, unknown>;
    expect(patch.completion_code).toBe(body.completion_code);
    expect(patch.completed_at).toBeDefined();
  });

  it("is idempotent when completion_code is already set (returns existing code, no write)", async () => {
    state.existingSession = {
      session_id: "s2",
      started_at: "2026-04-21T00:00:00Z",
      completed_at: "2026-04-21T00:05:00Z",
      completion_code: "ABCDEFGH",
    };
    const res = await callPOST({ session_id: "s2" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.completion_code).toBe("ABCDEFGH");
    expect(body.duration_ms).toBe(300_000);

    const updateCalls = state.calls.filter((c) => c.op === "update");
    expect(updateCalls).toHaveLength(0);
  });

  it("is idempotent when completion_code exists but completed_at is null (partial-state path, no write)", async () => {
    state.existingSession = {
      session_id: "s2p",
      started_at: "2026-04-21T00:00:00Z",
      completed_at: null,
      completion_code: "PARTIAL1",
    };
    const res = await callPOST({ session_id: "s2p" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.completion_code).toBe("PARTIAL1");
    const updateCalls = state.calls.filter((c) => c.op === "update");
    expect(updateCalls).toHaveLength(0);
  });

  it("on a lost race (conditional update matches 0 rows), re-reads and returns the persisted code", async () => {
    state.existingSession = {
      session_id: "s-race",
      started_at: "2026-04-21T00:00:00Z",
      completed_at: null,
      completion_code: null,
    };
    state.updatedSession = null; // update matched 0 rows (raced)
    state.reReadSession = {
      session_id: "s-race",
      started_at: "2026-04-21T00:00:00Z",
      completed_at: "2026-04-21T00:00:07Z",
      completion_code: "WINNER12",
    };
    const res = await callPOST({ session_id: "s-race" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.completion_code).toBe("WINNER12");
    expect(body.duration_ms).toBe(7_000);

    const selects = state.calls.filter((c) => c.op === "select.eq.maybeSingle");
    expect(selects.length).toBe(2);
  });

  it("returns 500 when the conditional update fails with a DB error", async () => {
    state.existingSession = {
      session_id: "s3",
      started_at: null,
      completed_at: null,
      completion_code: null,
    };
    state.updatedSession = null;
    state.updateError = { message: "db down" };
    const res = await callPOST({ session_id: "s3" });
    expect(res.status).toBe(500);
  });

  it("returns 500 when the update matches 0 rows and re-read finds nothing (shouldn't happen, but defensive)", async () => {
    state.existingSession = {
      session_id: "s-impossible",
      started_at: null,
      completed_at: null,
      completion_code: null,
    };
    state.updatedSession = null;
    state.reReadSession = {
      session_id: "s-impossible",
      started_at: null,
      completed_at: null,
      completion_code: null,
    };
    const res = await callPOST({ session_id: "s-impossible" });
    expect(res.status).toBe(500);
  });

  it("duration_ms on fresh completion is computed from started_at..now()", async () => {
    const now = Date.now();
    state.existingSession = {
      session_id: "s4",
      started_at: new Date(now - 12345).toISOString(),
      completed_at: null,
      completion_code: null,
    };
    state.updatedSession = {
      session_id: "s4",
      started_at: new Date(now - 12345).toISOString(),
      completed_at: new Date(now).toISOString(),
      completion_code: "DUR12345",
    };
    const res = await callPOST({ session_id: "s4" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.duration_ms).toBeGreaterThanOrEqual(12000);
    expect(body.duration_ms).toBeLessThan(20000);
  });
});
