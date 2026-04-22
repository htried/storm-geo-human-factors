"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Citation {
  n: number;
  url: string;
  title: string;
}

export function AgentReport(props: { text: string; citations: Citation[] }) {
  return (
    <section data-testid="agent-report" className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
        Report
      </h3>
      <article className="prose prose-slate max-w-none rounded border border-gray-200 bg-white p-4">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{props.text}</ReactMarkdown>
      </article>

      {props.citations.length > 0 && (
        <section data-testid="agent-citations" className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Citations
          </h4>
          <ol className="space-y-1 text-sm">
            {props.citations.map((c) => (
              <li key={c.n}>
                <span className="font-mono">[{c.n}] </span>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#1a0dab] hover:underline"
                >
                  {c.title}
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}
    </section>
  );
}
