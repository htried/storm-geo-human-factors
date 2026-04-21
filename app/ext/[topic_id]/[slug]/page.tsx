import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { loadCorpus } from "@/lib/corpus";
import { LogVisitBeacon } from "./LogVisitBeacon";

interface PageProps {
  params: Promise<{ topic_id: string; slug: string }>;
}

export const dynamic = "force-dynamic";

export default async function ExtLandingPage({ params }: PageProps) {
  const { topic_id, slug } = await params;

  const corpus = await loadCorpus();
  const topic = corpus.topics.find((t) => t.topic_id === topic_id);
  if (!topic) notFound();
  const mal = topic.malicious_source;
  if (!mal || mal.url_slug !== slug) notFound();

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <FakeBrowserChrome displayedUrl={mal.displayed_url} title={mal.title} />

      <article className="mx-auto max-w-3xl px-6 py-8 prose prose-slate">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {mal.landing_markdown}
        </ReactMarkdown>
      </article>

      <LogVisitBeacon topicId={topic_id} slug={slug} />
    </div>
  );
}

function FakeBrowserChrome(props: { displayedUrl: string; title: string }) {
  return (
    <header
      className="border-b border-gray-200 bg-gray-50"
      data-testid="ext-chrome"
    >
      <div className="mx-auto max-w-5xl px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5" aria-hidden>
            <span className="h-3 w-3 rounded-full bg-red-400" />
            <span className="h-3 w-3 rounded-full bg-yellow-400" />
            <span className="h-3 w-3 rounded-full bg-green-400" />
          </div>
          <div
            className="flex-1 rounded-full border border-gray-300 bg-white px-4 py-1.5 font-mono text-sm text-gray-700"
            data-testid="ext-url-bar"
          >
            <span className="text-gray-400">https://</span>
            {props.displayedUrl}
          </div>
        </div>
        <h1 className="mt-3 truncate text-sm text-gray-500" data-testid="ext-tab-title">
          {props.title}
        </h1>
      </div>
    </header>
  );
}
