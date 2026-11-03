import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // lib/corpus.ts reads the corpus with fs at runtime (path from CORPUS_PATH), which
  // file tracing can't see. Ship the committed corpora with every server route.
  outputFileTracingIncludes: {
    "/**": ["./app/data/corpus.procon.json", "./app/data/corpus.mock.json"],
  },
};

export default nextConfig;
