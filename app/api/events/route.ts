import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabase } from "@/lib/supabase";
import { logEvents } from "@/lib/events";

const MAX_BATCH = 100;

const EventSchema = z.object({
  t_ms: z.number().int().nonnegative(),
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const BodySchema = z.object({
  session_id: z.string().min(1),
  events: z.array(EventSchema),
});

function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status: 400 });
}

export async function POST(req: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest("invalid JSON body");
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return badRequest("invalid body", {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }
  const { session_id, events } = parsed.data;

  if (events.length > MAX_BATCH) {
    return badRequest(`batch too large: ${events.length} > ${MAX_BATCH}`);
  }

  if (events.length === 0) {
    return NextResponse.json({ inserted: 0 });
  }

  const sb = getSupabase();
  const { data: session, error: lookupErr } = await sb
    .from("sessions")
    .select("session_id")
    .eq("session_id", session_id)
    .maybeSingle();

  if (lookupErr) {
    return NextResponse.json(
      { error: "failed to look up session", detail: lookupErr.message },
      { status: 500 },
    );
  }
  if (!session) {
    return NextResponse.json({ error: "unknown session_id" }, { status: 404 });
  }

  try {
    await logEvents(
      events.map((e) => ({
        sessionId: session_id,
        t_ms: e.t_ms,
        type: e.type,
        payload: e.payload,
      })),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "failed to insert events", detail: msg },
      { status: 500 },
    );
  }

  return NextResponse.json({ inserted: events.length });
}
