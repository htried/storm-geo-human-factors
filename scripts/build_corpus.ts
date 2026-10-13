import fs from "node:fs";
import path from "node:path";

import { CorpusSchema, type Corpus, type MaliciousSource, type Topic } from "@/lib/corpus-types";
import { compileTimeline } from "./compile_timeline";
import { embedTopicsData } from "./embed_topics";

const DEFAULT_SOURCE_ROOT = path.join(process.cwd(), "corpus_sources");
const DEFAULT_OUT_PATH = path.join(process.cwd(), "app", "data", "corpus.json");

function parseFrontmatter(md: string): { attrs: Record<string, string>; body: string } {
  if (!md.startsWith("---\n")) return { attrs: {}, body: md };
  const end = md.indexOf("\n---\n", 4);
  if (end === -1) return { attrs: {}, body: md };
  const fm = md.slice(4, end);
  const body = md.slice(end + 5);
  const attrs: Record<string, string> = {};
  for (const line of fm.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    attrs[k] = v;
  }
  return { attrs, body };
}

function requireAttr(attrs: Record<string, string>, key: string): string {
  const v = attrs[key];
  if (!v) throw new Error(`malicious_source.md missing frontmatter key: ${key}`);
  return v;
}

async function buildTopicFromSourceDir(topicDir: string): Promise<Omit<Topic, "topic_embedding">> {
  const topicId = path.basename(topicDir);
  const topicText = (await fs.promises.readFile(path.join(topicDir, "topic.md"), "utf8")).trim();

  const malRaw = await fs.promises.readFile(path.join(topicDir, "malicious_source.md"), "utf8");
  const parsedMal = parseFrontmatter(malRaw);
  const malicious: MaliciousSource = {
    title: requireAttr(parsedMal.attrs, "title"),
    url_slug: requireAttr(parsedMal.attrs, "url_slug"),
    displayed_url: requireAttr(parsedMal.attrs, "displayed_url"),
    snippet: requireAttr(parsedMal.attrs, "snippet"),
    landing_markdown: parsedMal.body.trim(),
  };

  const vanillaDir = path.join(topicDir, "vanilla");
  const injectedDir = path.join(topicDir, "injected");

  const vanillaTimeline = await compileTimeline({
    instanceDumpPath: path.join(vanillaDir, "instance_dump.json"),
    logPath: path.join(vanillaDir, "log.json"),
    reportPath: path.join(vanillaDir, "report.md"),
  });
  const injectedTimeline = await compileTimeline({
    instanceDumpPath: path.join(injectedDir, "instance_dump.json"),
    logPath: path.join(injectedDir, "log.json"),
    reportPath: path.join(injectedDir, "report.md"),
  });

  return {
    topic_id: topicId,
    topic_text: topicText,
    vanilla_timeline: vanillaTimeline,
    injected_timeline: injectedTimeline,
    malicious_source: malicious,
  };
}

export interface BuildCorpusOptions {
  sourceRoot?: string;
  outPath?: string;
  embeddingModel?: string;
  embedBatch?: (texts: string[], model: string) => Promise<number[][]>;
  /** Leave topic_embedding empty (no OpenAI call). For MOCK_EXTERNAL_APIS corpora. */
  skipEmbeddings?: boolean;
}

export async function buildCorpus(options: BuildCorpusOptions = {}): Promise<Corpus> {
  const sourceRoot = options.sourceRoot ?? DEFAULT_SOURCE_ROOT;
  const outPath = options.outPath ?? DEFAULT_OUT_PATH;
  const embeddingModel = options.embeddingModel ?? process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";

  const entries = await fs.promises.readdir(sourceRoot, { withFileTypes: true });
  const topicDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(sourceRoot, e.name))
    .sort();

  if (topicDirs.length === 0) {
    throw new Error(`buildCorpus: no topic directories under ${sourceRoot}`);
  }

  const seedTopics = await Promise.all(topicDirs.map(buildTopicFromSourceDir));
  const unembedded = seedTopics.map((t) => ({
    ...t,
    topic_embedding: [] as number[],
    embedding_model: embeddingModel,
    embedding_input_hash: undefined,
  }));
  const embedded = options.skipEmbeddings
    ? unembedded
    : await embedTopicsData(unembedded, {
        model: embeddingModel,
        embedBatch: options.embedBatch,
      });

  const corpus: Corpus = {
    version: new Date().toISOString(),
    embedding_model: embeddingModel,
    topics: embedded.map((t) => ({
      topic_id: t.topic_id,
      topic_text: t.topic_text,
      topic_embedding: t.topic_embedding ?? [],
      vanilla_timeline: t.vanilla_timeline,
      injected_timeline: t.injected_timeline,
      malicious_source: t.malicious_source,
    })),
  };

  const validated = CorpusSchema.parse(corpus);
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await fs.promises.writeFile(outPath, JSON.stringify(validated, null, 2), "utf8");
  return validated;
}

async function main() {
  const args = process.argv.slice(2);
  const skipEmbeddings = args.includes("--skip-embeddings");
  const outIdx = args.indexOf("--out");
  const outPath = outIdx >= 0 ? args[outIdx + 1] : undefined;
  await buildCorpus({ skipEmbeddings, outPath });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
