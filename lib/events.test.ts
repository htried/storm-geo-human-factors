import { describe, it, expect, vi, beforeEach } from "vitest";

type InsertCall = { table: string; rows: unknown[] };
const calls: InsertCall[] = [];
let nextError: { message: string } | null = null;

vi.mock("./supabase", () => ({
  getSupabase: () => ({
    from: (table: string) => ({
      insert: async (rows: unknown[]) => {
        calls.push({ table, rows });
        return { data: null, error: nextError };
      },
    }),
  }),
}));

beforeEach(() => {
  calls.length = 0;
  nextError = null;
});

describe("logEvent", () => {
  it("inserts a single row into events with defaults for payload", async () => {
    const { logEvent } = await import("./events");
    await logEvent({
      sessionId: "11111111-1111-1111-1111-111111111111",
      t_ms: 123,
      type: "query_submitted",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.table).toBe("events");
    expect(calls[0]!.rows).toEqual([
      {
        session_id: "11111111-1111-1111-1111-111111111111",
        t_ms: 123,
        type: "query_submitted",
        payload: {},
      },
    ]);
  });

  it("passes supplied payload verbatim", async () => {
    const { logEvent } = await import("./events");
    await logEvent({
      sessionId: "s",
      t_ms: 1,
      type: "result_clicked",
      payload: { rank: 3, url: "https://x" },
    });
    expect(calls[0]!.rows).toEqual([
      {
        session_id: "s",
        t_ms: 1,
        type: "result_clicked",
        payload: { rank: 3, url: "https://x" },
      },
    ]);
  });

  it("throws on supabase error", async () => {
    nextError = { message: "boom" };
    const { logEvent } = await import("./events");
    await expect(
      logEvent({ sessionId: "s", t_ms: 0, type: "x" }),
    ).rejects.toThrow(/boom/);
  });
});

describe("logEvents", () => {
  it("inserts all rows in one call and normalizes payload defaults", async () => {
    const { logEvents } = await import("./events");
    await logEvents([
      { sessionId: "s", t_ms: 0, type: "a" },
      { sessionId: "s", t_ms: 10, type: "b", payload: { k: 1 } },
      { sessionId: "s", t_ms: 20, type: "c", payload: {} },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.rows).toEqual([
      { session_id: "s", t_ms: 0, type: "a", payload: {} },
      { session_id: "s", t_ms: 10, type: "b", payload: { k: 1 } },
      { session_id: "s", t_ms: 20, type: "c", payload: {} },
    ]);
  });

  it("is a no-op for an empty array", async () => {
    const { logEvents } = await import("./events");
    await logEvents([]);
    expect(calls).toHaveLength(0);
  });

  it("throws on supabase error", async () => {
    nextError = { message: "db down" };
    const { logEvents } = await import("./events");
    await expect(
      logEvents([{ sessionId: "s", t_ms: 0, type: "a" }]),
    ).rejects.toThrow(/db down/);
  });
});
