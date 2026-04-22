"use client";

import { useCallback, useMemo, useState } from "react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

function uid() {
  return Math.random().toString(36).slice(2);
}

function parseSseChunk(chunk: string): { event: string; data: Record<string, unknown> } | null {
  const lines = chunk.split("\n");
  let event = "message";
  let data = "";
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    return { event, data: JSON.parse(data) as Record<string, unknown> };
  } catch {
    return null;
  }
}

export function ChatPanel(props: { sessionId: string }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inFlight, setInFlight] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSend = useMemo(() => input.trim().length > 0 && !inFlight, [input, inFlight]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || inFlight) return;
    setErr(null);
    setInFlight(true);
    setInput("");
    const userMsg: Message = { id: uid(), role: "user", content: text };
    const assistantId = uid();
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", content: "" }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: props.sessionId, user_message: text }),
      });
      if (!res.ok || !res.body) {
        const raw: unknown = await res.json().catch(() => ({}));
        throw new Error(
          (raw as { error?: string }).error ?? `chat failed (${res.status})`,
        );
      }
      const decoder = new TextDecoder();
      const reader = res.body.getReader();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split("\n\n");
        buf = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const parsed = parseSseChunk(chunk);
          if (!parsed) continue;
          if (parsed.event === "token" && typeof parsed.data.token === "string") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + parsed.data.token } : m,
              ),
            );
          } else if (parsed.event === "error") {
            throw new Error(String(parsed.data.message ?? "chat stream error"));
          }
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setInFlight(false);
    }
  }, [inFlight, input, props.sessionId]);

  return (
    <section data-testid="chat-panel" className="space-y-3 rounded border border-gray-200 p-4 dark:border-gray-700 dark:bg-gray-950/40">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Follow-up chat
      </h3>

      <div className="space-y-2" data-testid="chat-messages">
        {messages.map((m) => (
          <div
            key={m.id}
            data-testid={`chat-msg-${m.role}`}
            className={
              m.role === "user"
                ? "ml-auto max-w-[80%] rounded bg-blue-700 px-3 py-2 text-sm text-white dark:bg-blue-600"
                : "mr-auto max-w-[80%] rounded bg-gray-100 px-3 py-2 text-sm text-gray-900 dark:bg-gray-900 dark:text-gray-100"
            }
          >
            {m.content || (m.role === "assistant" && inFlight ? "…" : "")}
          </div>
        ))}
      </div>

      {err && (
        <p data-testid="chat-error" className="text-sm text-red-700 dark:text-red-300">
          {err}
        </p>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          data-testid="chat-input"
          className="flex-1 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a follow-up question..."
          disabled={inFlight}
        />
        <button
          data-testid="chat-send"
          type="submit"
          className="rounded bg-blue-700 px-3 py-2 text-sm text-white disabled:bg-gray-400 dark:bg-blue-600"
          disabled={!canSend}
        >
          Send
        </button>
      </form>
    </section>
  );
}
