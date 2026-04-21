import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { getSupabase } from "@/lib/supabase";
import {
  CONDITIONS,
  assignCondition,
  type Condition,
} from "@/lib/assignment";
import { loadCorpus } from "@/lib/corpus";
import { getAppConfig } from "@/lib/config";

const BodySchema = z.object({
  participant_id: z.string().min(1),
  topic_id: z.string().min(1).optional(),
  condition_override: z.enum(CONDITIONS).optional(),
  user_agent: z.string().optional(),
  referrer: z.string().optional(),
});

function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status: 400 });
}

function extractClientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  return real?.trim() || null;
}

function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}|${ip}`).digest("hex");
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
  const body = parsed.data;

  const env = loadEnv();
  const sb = getSupabase();

  const { data: existing, error: existingErr } = await sb
    .from("sessions")
    .select("*")
    .eq("participant_id", body.participant_id)
    .maybeSingle();

  if (existingErr) {
    return NextResponse.json(
      { error: "failed to look up session", detail: existingErr.message },
      { status: 500 },
    );
  }

  const corpus = await loadCorpus();

  if (existing) {
    const topic = corpus.topics.find((t) => t.topic_id === existing.topic_id);
    return NextResponse.json({
      session_id: existing.session_id,
      condition: existing.condition,
      topic_id: existing.topic_id,
      topic_text: topic?.topic_text ?? "",
    });
  }

  let condition: Condition;
  let assigned_by: "hash" | "researcher_override";
  if (body.condition_override) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${env.ADMIN_TOKEN}`) {
      return NextResponse.json(
        { error: "condition_override requires admin token" },
        { status: 403 },
      );
    }
    condition = body.condition_override;
    assigned_by = "researcher_override";
  } else {
    condition = assignCondition(body.participant_id, env.ASSIGN_SECRET);
    assigned_by = "hash";
  }

  let topic_id = body.topic_id;
  if (!topic_id) {
    if (corpus.topics.length === 0) {
      return NextResponse.json(
        { error: "no topics available in corpus" },
        { status: 500 },
      );
    }
    const idx = Math.floor(Math.random() * corpus.topics.length);
    topic_id = corpus.topics[idx]!.topic_id;
  }
  const topic = corpus.topics.find((t) => t.topic_id === topic_id);
  if (!topic) {
    return badRequest(`unknown topic_id: ${topic_id}`);
  }

  const ip = extractClientIp(req);
  const ipHash = ip ? hashIp(ip, env.IP_HASH_SALT) : null;

  const { error: upsertErr } = await sb.from("participants").upsert(
    {
      participant_id: body.participant_id,
      user_agent: body.user_agent ?? null,
      ip_hash: ipHash,
      referrer: body.referrer ?? null,
    },
    { onConflict: "participant_id", ignoreDuplicates: true },
  );
  if (upsertErr) {
    return NextResponse.json(
      { error: "failed to upsert participant", detail: upsertErr.message },
      { status: 500 },
    );
  }

  const cfg = await getAppConfig();

  // The initial lookup above short-circuits the common idempotent case, but
  // two concurrent POSTs for a *new* participant can both pass it. The
  // sessions table has a unique constraint on participant_id, so we use an
  // upsert with ignoreDuplicates to make the insert atomic: the loser of the
  // race gets `data === null` and re-reads the winner's row.
  const { data: insertedRows, error: insertErr } = await sb
    .from("sessions")
    .upsert(
      {
        participant_id: body.participant_id,
        condition,
        topic_id,
        assigned_by,
        chat_model_used: cfg.chat_model,
        chat_temperature_used: cfg.chat_temperature,
        embedding_model_used: cfg.embedding_model,
      },
      { onConflict: "participant_id", ignoreDuplicates: true },
    )
    .select();

  if (insertErr) {
    return NextResponse.json(
      { error: "failed to create session", detail: insertErr.message },
      { status: 500 },
    );
  }

  const session =
    Array.isArray(insertedRows) && insertedRows.length > 0
      ? insertedRows[0]
      : null;

  if (session) {
    return NextResponse.json({
      session_id: (session as { session_id: string }).session_id,
      condition,
      topic_id,
      topic_text: topic.topic_text,
    });
  }

  // Lost the race: another request for the same participant just created a
  // session. Re-read and return the winning row so the response is
  // idempotent regardless of which caller we were.
  const { data: raced, error: racedErr } = await sb
    .from("sessions")
    .select("*")
    .eq("participant_id", body.participant_id)
    .maybeSingle();

  if (racedErr || !raced) {
    return NextResponse.json(
      {
        error: "failed to resolve session after concurrent create",
        detail: racedErr?.message,
      },
      { status: 500 },
    );
  }

  const racedTopic = corpus.topics.find(
    (t) => t.topic_id === (raced as { topic_id: string }).topic_id,
  );
  return NextResponse.json({
    session_id: (raced as { session_id: string }).session_id,
    condition: (raced as { condition: Condition }).condition,
    topic_id: (raced as { topic_id: string }).topic_id,
    topic_text: racedTopic?.topic_text ?? "",
  });
}
