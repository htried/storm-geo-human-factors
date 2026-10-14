import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
  rows: unknown[];
  error: { message: string } | null;
  table: string | null;
} = {
  rows: [],
  error: null,
  table: null,
};

const adminApi = vi.hoisted(() => ({ enabled: true }));

vi.mock("@/lib/env", () => ({
  loadEnv: () => ({ ADMIN_TOKEN: "admin-token-12345", ADMIN_API_ENABLED: adminApi.enabled }),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: (table: string) => {
      state.table = table;
      return {
        select: async (_cols: string) => ({
          data: state.rows,
          error: state.error,
        }),
      };
    },
  }),
}));

function req(query: string, auth?: string): Request {
  return new Request(`http://localhost/api/admin/export?${query}`, {
    method: "GET",
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [];
  state.error = null;
  state.table = null;
  adminApi.enabled = true;
});

describe("GET /api/admin/export", () => {
  it("404s when ADMIN_API_ENABLED is off, even with a valid token", async () => {
    adminApi.enabled = false;
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://test.local/api/admin/export?table=events&format=csv", {
        headers: { authorization: "Bearer admin-token-12345" },
      }),
    );
    expect(res.status).toBe(404);
  });

  it("requires admin auth", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("table=events&format=csv"));
    expect(res.status).toBe(401);
  });

  it("streams CSV for events", async () => {
    state.rows = [
      {
        event_id: 1,
        session_id: "s1",
        t_ms: 10,
        server_at: "2026-01-01T00:00:00.000Z",
        type: "query_submitted",
        payload: { query: "x" },
      },
    ];
    const { GET } = await import("./route");
    const res = await GET(
      req("table=events&format=csv", "Bearer admin-token-12345"),
    );
    expect(res.status).toBe(200);
    expect(state.table).toBe("events");
    const csv = await res.text();
    expect(csv.split("\n")[0]).toBe("event_id,session_id,t_ms,server_at,type,payload");
    expect(csv).toContain("query_submitted");
    expect(csv).toContain('"{""query"":""x""}"');
  });

  it("rejects invalid table/format", async () => {
    const { GET } = await import("./route");
    const badTable = await GET(
      req("table=unknown&format=csv", "Bearer admin-token-12345"),
    );
    expect(badTable.status).toBe(400);
    const badFormat = await GET(
      req("table=events&format=json", "Bearer admin-token-12345"),
    );
    expect(badFormat.status).toBe(400);
  });

  it("neutralizes spreadsheet formulas in exported cells", async () => {
    state.rows = [
      {
        message_id: "m1",
        session_id: "s1",
        turn_number: 1,
        role: "user",
        content: '=HYPERLINK("http://evil.example","click")',
        is_malicious_context: false,
        model: null,
        latency_ms: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    const { GET } = await import("./route");
    const res = await GET(
      req("table=chat_messages&format=csv", "Bearer admin-token-12345"),
    );
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
  });
});
