"use client";

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Citation {
  n: number;
  url: string;
  title: string;
}

function toWikiMarkdown(text: string, citations: Citation[]): string {
  const normalizedText = text
    .replaceAll("\\r\\n", "\n")
    .replaceAll("\\n", "\n")
    .replaceAll("\r\n", "\n");
  const sorted = [...citations].sort((a, b) => a.n - b.n);
  const citationSet = new Set(sorted.map((c) => c.n));
  const hasHeading = /^\s*#\s+/m.test(normalizedText);
  const body = hasHeading
    ? normalizedText
    : `# Agent Research Report\n\n${normalizedText}`;
  const withFootnotes = body.replace(/\[(\d+)\]/g, (full, nRaw: string) => {
    const n = Number(nRaw);
    return citationSet.has(n) ? `[^${n}]` : full;
  });
  if (sorted.length === 0) return withFootnotes;
  const footnotes = sorted
    .map((c) => `[^${c.n}]: [${c.title}](${c.url})`)
    .join("\n");
  return `${withFootnotes}\n\n## Sources\n\n${footnotes}\n`;
}

export function AgentReport(props: {
  text: string;
  citations: Citation[];
  streaming?: boolean;
}) {
  const wikiReport = toWikiMarkdown(props.text, props.citations);
  const articleRef = useRef<HTMLElement | null>(null);
  const stickToBottomRef = useRef(true);

  function handleScroll() {
    const el = articleRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 24;
  }

  useEffect(() => {
    const el = articleRef.current;
    if (!el) return;
    if (!stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [wikiReport]);

  return (
    <section data-testid="agent-report" className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Wiki Report
      </h3>
      <article
        ref={articleRef}
        onScroll={handleScroll}
        className="prose prose-slate max-h-96 max-w-none overflow-y-auto rounded border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900 dark:prose-invert"
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => (
              <h1 className="mb-3 mt-1 border-b border-gray-200 pb-2 text-2xl font-bold dark:border-gray-700">
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 className="mb-2 mt-4 text-xl font-semibold">{children}</h2>
            ),
            h3: ({ children }) => (
              <h3 className="mb-2 mt-3 text-lg font-semibold">{children}</h3>
            ),
            p: ({ children }) => (
              <p className="my-2 leading-7 text-gray-800 dark:text-gray-200">{children}</p>
            ),
            ul: ({ children }) => (
              <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
            ),
            li: ({ children }) => <li className="leading-6">{children}</li>,
            a: ({ href, children }) => (
              href?.startsWith("#") ? (
                <a
                  href={href}
                  className="text-blue-700 underline decoration-blue-500/60 underline-offset-2 hover:text-blue-600 dark:text-blue-300 dark:hover:text-blue-200"
                >
                  {children}
                </a>
              ) : (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-700 underline decoration-blue-500/60 underline-offset-2 hover:text-blue-600 dark:text-blue-300 dark:hover:text-blue-200"
                >
                  {children}
                </a>
              )
            ),
            blockquote: ({ children }) => (
              <blockquote className="my-3 border-l-4 border-gray-300 pl-4 italic text-gray-700 dark:border-gray-600 dark:text-gray-300">
                {children}
              </blockquote>
            ),
            code: ({ children }) => (
              <code className="rounded bg-gray-100 px-1 py-0.5 text-[0.9em] dark:bg-gray-800">
                {children}
              </code>
            ),
          }}
        >
          {wikiReport}
        </ReactMarkdown>
      </article>
      {props.streaming && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Streaming report output...
        </p>
      )}
    </section>
  );
}
