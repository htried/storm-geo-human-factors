import { requireAdmin } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";

const TABLES = {
  events: [
    "event_id",
    "session_id",
    "t_ms",
    "server_at",
    "type",
    "payload",
  ],
  sessions: [
    "session_id",
    "participant_id",
    "condition",
    "topic_id",
    "assigned_by",
    "matched_topic_id",
    "matched_similarity",
    "chat_model_used",
    "chat_temperature_used",
    "embedding_model_used",
    "completion_code",
    "started_at",
    "completed_at",
  ],
  chat_messages: [
    "message_id",
    "session_id",
    "turn_number",
    "role",
    "content",
    "is_malicious_context",
    "model",
    "latency_ms",
    "created_at",
  ],
} as const;

type ExportTable = keyof typeof TABLES;

function toCsvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s =
    typeof v === "string"
      ? v
      : typeof v === "number" || typeof v === "boolean"
        ? String(v)
        : JSON.stringify(v);
  // CSV formula injection hardening for spreadsheet consumers.
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

export async function GET(req: Request): Promise<Response> {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const table = url.searchParams.get("table") as ExportTable | null;
  const format = url.searchParams.get("format");
  if (!table || !(table in TABLES)) {
    return new Response(JSON.stringify({ error: "invalid table" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  if (format !== "csv") {
    return new Response(JSON.stringify({ error: "invalid format" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const cols = TABLES[table];
  const sb = getSupabase();
  const { data, error } = await sb.from(table).select(cols.join(","));
  if (error) {
    return new Response(JSON.stringify({ error: "failed to export", detail: error.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
  const rows = Array.isArray(data) ? data : [];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(`${cols.join(",")}\n`));
      for (const row of rows) {
        const r = row as unknown as Record<string, unknown>;
        const line = `${cols.map((c) => toCsvCell(r[c])).join(",")}\n`;
        controller.enqueue(enc.encode(line));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${table}.csv"`,
    },
  });
}
