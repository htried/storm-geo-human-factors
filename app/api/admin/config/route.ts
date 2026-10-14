import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { invalidateAppConfigCache } from "@/lib/config";

const BodySchema = z
  .object({
    chat_model: z.string().min(1).optional(),
    chat_temperature: z.number().finite().optional(),
    chat_max_tokens: z.number().int().positive().optional(),
    embedding_model: z.string().min(1).optional(),
    updated_by: z.string().min(1).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "at least one field must be provided",
  });

export async function POST(req: Request): Promise<Response> {
  const denied = requireAdmin(req);
  if (denied) return denied;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid body",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  const patch = parsed.data;
  const sb = getSupabase();
  const { data, error } = await sb
    .from("app_config")
    .upsert(
      {
        id: 1,
        ...patch,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    )
    .select("chat_model, chat_temperature, chat_max_tokens, embedding_model, updated_at, updated_by")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "failed to update app config", detail: error?.message },
      { status: 500 },
    );
  }

  invalidateAppConfigCache();
  return NextResponse.json(data);
}
