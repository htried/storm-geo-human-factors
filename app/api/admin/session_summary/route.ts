import { requireAdmin } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(req: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") {
    return json(404, { error: "not found" });
  }
  const denied = requireAdmin(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) return json(400, { error: "session_id is required" });

  const sb = getSupabase();
  const { data: session, error: sessionErr } = await sb
    .from("sessions")
    .select("session_id, participant_id, condition, topic_id, completion_code")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (sessionErr) return json(500, { error: "failed to read session" });
  if (!session) return json(404, { error: "unknown session" });

  const { data: events, error: eventsErr } = await sb
    .from("events")
    .select("type")
    .eq("session_id", sessionId);
  if (eventsErr) return json(500, { error: "failed to read events" });

  const { data: chats, error: chatsErr } = await sb
    .from("chat_messages")
    .select("message_id")
    .eq("session_id", sessionId);
  if (chatsErr) return json(500, { error: "failed to read chat messages" });

  const byType: Record<string, number> = {};
  for (const ev of Array.isArray(events) ? events : []) {
    const t = (ev as { type?: string }).type ?? "unknown";
    byType[t] = (byType[t] ?? 0) + 1;
  }

  return json(200, {
    session,
    event_count: Array.isArray(events) ? events.length : 0,
    events_by_type: byType,
    chat_message_count: Array.isArray(chats) ? chats.length : 0,
  });
}
