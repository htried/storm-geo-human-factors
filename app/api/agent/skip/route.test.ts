import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
  session: { condition: string } | null;
  sessionErr: { message: string } | null;
  logged: Array<{ type: string }>;
} = {
  session: null,
  sessionErr: null,
  logged: [],
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

vi.mock("@/lib/events", () => ({
  logEvent: vi.fn(async (e) => {
    state.logged.push(e);
  }),
}));

function req(body: unknown): Request {
  return new Request("http://localhost/api/agent/skip", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.session = { condition: "vanilla_agent" };
  state.sessionErr = null;
  state.logged = [];
});

describe("POST /api/agent/skip", () => {
  it("logs agent_skip_used for agent sessions", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ session_id: "sess-1" }));
    expect(res.status).toBe(200);
    expect(state.logged.some((e) => e.type === "agent_skip_used")).toBe(true);
  });

  it("returns 400 for non-agent sessions", async () => {
    state.session = { condition: "vanilla_search" };
    const { POST } = await import("./route");
    const res = await POST(req({ session_id: "sess-1" }));
    expect(res.status).toBe(400);
  });
});
