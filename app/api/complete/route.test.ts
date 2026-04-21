import { describe, it, expect, vi, beforeEach } from "vitest";

type Call = { op: string; table: string; args?: unknown };

const state: {
  existingSession: Record<string, unknown> | null;
  updatedSession: Record<string, unknown> | null;
  lookupError: { message: string } | null;
  updateError: { message: string } | null;
  calls: Call[];
} = {
  existingSession: null,
  updatedSession: null,
  lookupError: null,
  updateError: null,
  calls: [],
};

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          maybeSingle: async () => {
            state.calls.push({ op: "select.eq.maybeSingle", table });
            return { data: state.existingSession, error: state.lookupError };
          },
        }),
      }),
      update: (patch: unknown) => {
        state.calls.push({ op: "update", table, args: patch });
        return {
          eq: (_col: string, _val: unknown) => ({
            select: () => ({
              single: async () => ({
                data: state.updatedSession,
                error: state.updateError,
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
  state.updatedSession = null;
  state.lookupError = null;
  state.updateError = null;
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
      completed_at: null,
      completion_code: null,
    };
    state.updatedSession = { session_id: "s1" };
    const res = await callPOST({ session_id: "s1" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session_id).toBe("s1");
    expect(body.completion_code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(typeof body.duration_ms).toBe("number");

    const updateCall = state.calls.find((c) => c.op === "update");
    expect(updateCall).toBeDefined();
    const patch = updateCall!.args as Record<string, unknown>;
    expect(patch.completion_code).toBe(body.completion_code);
    expect(patch.completed_at).toBeDefined();
  });

  it("is idempotent: returns the existing completion_code without re-writing", async () => {
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

    const updateCalls = state.calls.filter((c) => c.op === "update");
    expect(updateCalls).toHaveLength(0);
  });

  it("returns 500 when update fails", async () => {
    state.existingSession = {
      session_id: "s3",
      completed_at: null,
      completion_code: null,
    };
    state.updatedSession = null;
    state.updateError = { message: "db down" };
    const res = await callPOST({ session_id: "s3" });
    expect(res.status).toBe(500);
  });

  it("includes duration_ms based on session.started_at when available", async () => {
    const now = Date.now();
    state.existingSession = {
      session_id: "s4",
      started_at: new Date(now - 12345).toISOString(),
      completed_at: null,
      completion_code: null,
    };
    state.updatedSession = { session_id: "s4" };
    const res = await callPOST({ session_id: "s4" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.duration_ms).toBeGreaterThanOrEqual(12000);
    expect(body.duration_ms).toBeLessThan(20000);
  });
});
