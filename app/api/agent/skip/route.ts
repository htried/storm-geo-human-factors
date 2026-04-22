import { NextResponse } from "next/server";
import { z } from "zod";

import { getSupabase } from "@/lib/supabase";
import { logEvent } from "@/lib/events";

const BodySchema = z.object({
  session_id: z.string().min(1),
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
  const { session_id } = parsed.data;

  const sb = getSupabase();
  const { data: session, error: sessionErr } = await sb
    .from("sessions")
    .select("condition")
    .eq("session_id", session_id)
    .maybeSingle();
  if (sessionErr) {
    return NextResponse.json({ error: "failed to look up session" }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "unknown session" }, { status: 404 });
  }
  const condition = (session as { condition: string }).condition;
  if (condition !== "vanilla_agent" && condition !== "injected_agent") {
    return badRequest("session is not in an agent condition");
  }

  await logEvent({
    sessionId: session_id,
    t_ms: Date.now(),
    type: "agent_skip_used",
    payload: { via: "api/agent/skip" },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
