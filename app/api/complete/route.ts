import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabase } from "@/lib/supabase";
import { generateCompletionCode } from "@/lib/completion";

const BodySchema = z.object({
  session_id: z.string().min(1),
});

function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status: 400 });
}

function computeDurationMs(startedAt: string | null | undefined): number {
  if (!startedAt) return 0;
  const t = Date.parse(startedAt);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Date.now() - t);
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
  const { data: existing, error: lookupErr } = await sb
    .from("sessions")
    .select("session_id, started_at, completed_at, completion_code")
    .eq("session_id", session_id)
    .maybeSingle();

  if (lookupErr) {
    return NextResponse.json(
      { error: "failed to look up session", detail: lookupErr.message },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json({ error: "unknown session_id" }, { status: 404 });
  }

  const startedAt =
    (existing as Record<string, unknown>).started_at as string | null | undefined;

  if (existing.completion_code && existing.completed_at) {
    return NextResponse.json({
      session_id,
      completion_code: existing.completion_code as string,
      duration_ms: computeDurationMs(startedAt),
    });
  }

  const code = generateCompletionCode();
  const completedAt = new Date().toISOString();

  const { data: updated, error: updateErr } = await sb
    .from("sessions")
    .update({ completion_code: code, completed_at: completedAt })
    .eq("session_id", session_id)
    .select()
    .single();

  if (updateErr || !updated) {
    return NextResponse.json(
      {
        error: "failed to finalize session",
        detail: updateErr?.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    session_id,
    completion_code: code,
    duration_ms: computeDurationMs(startedAt),
  });
}
