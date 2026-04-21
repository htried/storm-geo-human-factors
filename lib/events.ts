import { getSupabase } from "./supabase";

export interface EventInput {
  sessionId: string;
  t_ms: number;
  type: string;
  payload?: Record<string, unknown>;
}

interface EventRow {
  session_id: string;
  t_ms: number;
  type: string;
  payload: Record<string, unknown>;
}

function toRow(e: EventInput): EventRow {
  return {
    session_id: e.sessionId,
    t_ms: e.t_ms,
    type: e.type,
    payload: e.payload ?? {},
  };
}

export async function logEvent(e: EventInput): Promise<void> {
  await logEvents([e]);
}

export async function logEvents(events: EventInput[]): Promise<void> {
  if (events.length === 0) return;
  const sb = getSupabase();
  const { error } = await sb.from("events").insert(events.map(toRow));
  if (error) throw new Error(`failed to log events: ${error.message}`);
}
