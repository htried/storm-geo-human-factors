import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabase } from "@/lib/supabase";
import { generateCompletionCode } from "@/lib/completion";

const BodySchema = z.object({
  session_id: z.string().min(1),
});

interface SessionRow {
  session_id: string;
  started_at: string | null;
  completed_at: string | null;
  completion_code: string | null;
}

function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status: 400 });
}

function computeDuration(
  startedAt: string | null | undefined,
  completedAt: string | null | undefined,
): number {
  if (!startedAt) return 0;
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return 0;
  // If the session is already marked complete, anchor the duration on
  // completed_at so repeat calls don't return an ever-growing value.
  if (completedAt) {
    const end = Date.parse(completedAt);
    if (!Number.isNaN(end)) return Math.max(0, end - start);
  }
  return Math.max(0, Date.now() - start);
}

function okResponse(
  sessionId: string,
  row: { completion_code: string; started_at: string | null; completed_at: string | null },
) {
  return NextResponse.json({
    session_id: sessionId,
    completion_code: row.completion_code,
    duration_ms: computeDuration(row.started_at, row.completed_at),
  });
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

  const existingRow = existing as SessionRow;

  // Idempotent path: a non-null completion_code alone is authoritative. We
  // intentionally do not require completed_at to also be set — treating the
  // two as coupled would regenerate the code on a partially-written row.
  if (existingRow.completion_code) {
    return okResponse(session_id, {
      completion_code: existingRow.completion_code,
      started_at: existingRow.started_at,
      completed_at: existingRow.completed_at,
    });
  }

  const code = generateCompletionCode();
  const completedAt = new Date().toISOString();

  // Conditional update: only claim the session if completion_code is still
  // null. Two concurrent POSTs can both see null above, but only one will win
  // this update. The loser gets `data === null` and re-reads.
  const { data: updated, error: updateErr } = await sb
    .from("sessions")
    .update({ completion_code: code, completed_at: completedAt })
    .eq("session_id", session_id)
    .is("completion_code", null)
    .select("session_id, started_at, completed_at, completion_code")
    .maybeSingle();

  if (updateErr) {
    return NextResponse.json(
      { error: "failed to finalize session", detail: updateErr.message },
      { status: 500 },
    );
  }

  if (!updated) {
    // Lost the race. Re-read to return the code that actually got persisted.
    const { data: reRead, error: reReadErr } = await sb
      .from("sessions")
      .select("session_id, started_at, completed_at, completion_code")
      .eq("session_id", session_id)
      .maybeSingle();
    if (reReadErr) {
      return NextResponse.json(
        { error: "failed to resolve completion", detail: reReadErr.message },
        { status: 500 },
      );
    }
    if (reRead && (reRead as SessionRow).completion_code) {
      const r = reRead as SessionRow;
      return okResponse(session_id, {
        completion_code: r.completion_code!,
        started_at: r.started_at,
        completed_at: r.completed_at,
      });
    }
    return NextResponse.json(
      { error: "failed to finalize session" },
      { status: 500 },
    );
  }

  const u = updated as SessionRow;
  // Echo the values we just wrote rather than the DB round-trip: we know
  // `code` and `completedAt` are what successfully landed, and some test
  // fixtures return placeholder values from the mocked update.
  return okResponse(session_id, {
    completion_code: code,
    started_at: u.started_at ?? existingRow.started_at,
    completed_at: completedAt,
  });
}
