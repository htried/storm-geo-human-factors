import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
  session: Record<string, unknown> | null;
  events: Array<{ type: string }>;
  chats: Array<{ message_id: string }>;
  errors: { session?: string; events?: string; chats?: string };
} = {
  session: null,
  events: [],
  chats: [],
  errors: {},
};

const adminApi = vi.hoisted(() => ({ enabled: true }));

vi.mock("@/lib/env", () => ({
  loadEnv: () => ({ ADMIN_TOKEN: "admin-token-12345", ADMIN_API_ENABLED: adminApi.enabled }),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => {
          if (table === "sessions") {
            return {
              maybeSingle: async () => ({
                data: state.session,
                error: state.errors.session ? { message: state.errors.session } : null,
              }),
            };
          }
          if (table === "events") {
            return Promise.resolve({
              data: state.events,
              error: state.errors.events ? { message: state.errors.events } : null,
            });
          }
          if (table === "chat_messages") {
            return Promise.resolve({
              data: state.chats,
              error: state.errors.chats ? { message: state.errors.chats } : null,
            });
          }
          return Promise.resolve({ data: [], error: null });
        },
      }),
    }),
  }),
}));

function req(query: string, auth?: string): Request {
  return new Request(`http://localhost/api/admin/session_summary?${query}`, {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.session = {
    session_id: "s1",
    participant_id: "p1",
    condition: "vanilla_search",
    topic_id: "t1",
    completion_code: "ABCD2345",
  };
  state.events = [{ type: "query_submitted" }, { type: "result_clicked" }];
  state.chats = [{ message_id: "m1" }];
  state.errors = {};
  process.env.NODE_ENV = "test";
});

describe("GET /api/admin/session_summary", () => {
  it("requires admin auth and returns aggregate summary", async () => {
    const { GET } = await import("./route");
    const unauth = await GET(req("session_id=s1"));
    expect(unauth.status).toBe(401);

    const ok = await GET(req("session_id=s1", "Bearer admin-token-12345"));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.session.session_id).toBe("s1");
    expect(body.event_count).toBe(2);
    expect(body.events_by_type.query_submitted).toBe(1);
    expect(body.chat_message_count).toBe(1);
  });
});
