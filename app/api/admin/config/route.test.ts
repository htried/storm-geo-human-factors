import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
  upsertedRow: Record<string, unknown> | null;
  upsertError: { message: string } | null;
  selected: Record<string, unknown> | null;
  invalidated: number;
} = {
  upsertedRow: null,
  upsertError: null,
  selected: null,
  invalidated: 0,
};

vi.mock("@/lib/env", () => ({
  loadEnv: () => ({ ADMIN_TOKEN: "admin-token-12345" }),
}));

vi.mock("@/lib/config", () => ({
  invalidateAppConfigCache: () => {
    state.invalidated++;
  },
}));

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: (_table: string) => ({
      upsert: (row: Record<string, unknown>) => {
        state.upsertedRow = row;
        return {
          select: (_cols: string) => ({
            single: async () => ({
              data: state.selected,
              error: state.upsertError,
            }),
          }),
        };
      },
    }),
  }),
}));

function req(body: unknown, auth?: string): Request {
  return new Request("http://localhost/api/admin/config", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: auth } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.upsertedRow = null;
  state.upsertError = null;
  state.selected = {
    chat_model: "gpt-4o-mini",
    chat_temperature: 0.4,
    chat_max_tokens: 900,
    embedding_model: "text-embedding-3-small",
    updated_at: "2026-01-01T00:00:00.000Z",
    updated_by: "test",
  };
  state.invalidated = 0;
});

describe("POST /api/admin/config", () => {
  it("requires admin token", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ chat_model: "x" }));
    expect(res.status).toBe(401);
  });

  it("upserts config and invalidates cache", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      req({ chat_temperature: 0.4, updated_by: "tester" }, "Bearer admin-token-12345"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chat_temperature).toBe(0.4);
    expect(state.upsertedRow?.id).toBe(1);
    expect(state.invalidated).toBe(1);
  });
});
