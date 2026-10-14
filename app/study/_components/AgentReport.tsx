"use client";

import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { linkifyCitations, type Citation } from "@/lib/citations";

export type { Citation };

export type ReportLinkClick = { url: string; citation_n: number | null; where: "inline" | "sources" };

export function AgentReport(props: {
  text: string;
  citations: Citation[];
  onLinkClick?: (click: ReportLinkClick) => void;
}) {
  const { text, citations, onLinkClick } = props;
  const markdown = useMemo(() => linkifyCitations(text, citations), [text, citations]);

  const components = useMemo<Components>(
    () => ({
      a({ href, title, children }) {
        const isCitation = title === "citation";
        const n = isCitation ? Number(String(children).replace(/\D/g, "")) || null : null;
        const link = (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={isCitation ? "no-underline hover:underline" : undefined}
            onClick={() => href && onLinkClick?.({ url: href, citation_n: n, where: "inline" })}
          >
            {children}
          </a>
        );
        return isCitation ? <sup className="ml-0.5 text-[0.7em]">{link}</sup> : link;
      },
    }),
    [onLinkClick],
  );

  return (
    <section data-testid="agent-report" className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Report</h3>
      <article className="prose prose-slate max-w-none rounded border border-gray-200 bg-white p-5 prose-headings:mt-5 prose-headings:mb-2 prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-a:text-[#1a0dab]">
        {text ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {markdown}
          </ReactMarkdown>
        ) : (
          <p className="text-sm text-gray-400">The report will appear here once research is complete.</p>
        )}
      </article>

      {citations.length > 0 && (
        <section data-testid="agent-citations" className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Sources</h4>
          <ol className="space-y-1 text-sm">
            {citations.map((c) => (
              <li key={c.n} className="flex gap-2">
                <span className="font-mono text-gray-500">[{c.n}]</span>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#1a0dab] hover:underline"
                  onClick={() => onLinkClick?.({ url: c.url, citation_n: c.n, where: "sources" })}
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
