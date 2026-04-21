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

  const { data: session, error: insertErr } = await sb
    .from("sessions")
    .insert({
      participant_id: body.participant_id,
      condition,
      topic_id,
      assigned_by,
      chat_model_used: cfg.chat_model,
      chat_temperature_used: cfg.chat_temperature,
      embedding_model_used: cfg.embedding_model,
    })
    .select()
    .single();

  if (insertErr || !session) {
    return NextResponse.json(
      { error: "failed to create session", detail: insertErr?.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    session_id: session.session_id,
    condition,
    topic_id,
    topic_text: topic.topic_text,
  });
}
