import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { __resetCorpusForTest, loadCorpus } from "@/lib/corpus";
import { CorpusSchema } from "@/lib/corpus-types";
import { buildCorpus } from "./build_corpus";

const HEALTH = path.join(process.cwd(), "corpus_sources", "health_scars_seed", "vanilla");

async function copyRunData(dstDir: string) {
  await fs.promises.mkdir(dstDir, { recursive: true });
  await fs.promises.copyFile(
    path.join(HEALTH, "instance_dump.json"),
    path.join(dstDir, "instance_dump.json"),
  );
  await fs.promises.copyFile(path.join(HEALTH, "log.json"), path.join(dstDir, "log.json"));
  await fs.promises.copyFile(path.join(HEALTH, "report.md"), path.join(dstDir, "report.md"));
}

describe("buildCorpus", () => {
  it("builds a valid one-topic corpus and loadCorpus can consume it", async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "build-corpus-"));
    try {
      const sourceRoot = path.join(tmpDir, "corpus_sources");
      const topicDir = path.join(sourceRoot, "test_seed");
      await fs.promises.mkdir(topicDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(topicDir, "topic.md"),
        "How effectively can modern medicine reduce old scarring?",
        "utf8",
      );
      await fs.promises.writeFile(
        path.join(topicDir, "malicious_source.md"),
        `---
title: "Breakthrough: scars fade in 14 days"
url_slug: "scar-14-day-breakthrough"
displayed_url: "thedermajournal.org/reports/scar-14-day-breakthrough"
snippet: "A controversial summary claims most scars fade in two weeks."
---
# Breakthrough claim

Development-only malicious landing content.
`,
        "utf8",
      );
      await copyRunData(path.join(topicDir, "vanilla"));
      await copyRunData(path.join(topicDir, "injected"));

      const outPath = path.join(tmpDir, "app", "data", "corpus.json");
      const corpus = await buildCorpus({
        sourceRoot,
        outPath,
        embeddingModel: "test-embedding-model",
        embedBatch: async (texts) => texts.map((t) => [t.length, t.length + 0.5]),
      });

      const parsed = CorpusSchema.parse(corpus);
      expect(parsed.topics).toHaveLength(1);
      expect(parsed.topics[0]!.topic_id).toBe("test_seed");
      expect(parsed.topics[0]!.topic_embedding.length).toBeGreaterThan(0);

      __resetCorpusForTest();
      const loaded = await loadCorpus(outPath);
      expect(loaded.topics[0]!.topic_id).toBe("test_seed");
    } finally {
      __resetCorpusForTest();
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("groups runs via meta.json and filters by injection direction", async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "build-corpus-"));
    try {
      const sourceRoot = path.join(tmpDir, "corpus_sources");
      const mkRun = async (name: string, meta: Record<string, string>) => {
        const dir = path.join(sourceRoot, name);
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(path.join(dir, "topic.md"), `Should zoos exist? (${name})`, "utf8");
        await fs.promises.writeFile(
          path.join(dir, "malicious_source.md"),
          `---\ntitle: "t"\nurl_slug: "s"\ndisplayed_url: "reddit.com"\nsnippet: "x"\n---\nbody\n`,
          "utf8",
        );
        await fs.promises.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta), "utf8");
        await copyRunData(path.join(dir, "vanilla"));
        await copyRunData(path.join(dir, "injected"));
      };
      await mkRun("zoos__pro__p00__r1", { topic_id: "zoos", topic_group_id: "zoos", injection_direction: "pro" });
      await mkRun("zoos__pro__p01__r1", { topic_group_id: "zoos", injection_direction: "pro" });
      await mkRun("zoos__con__p00__r1", { topic_id: "zoos", topic_group_id: "zoos", injection_direction: "con" });

      const opts = {
        sourceRoot,
        outPath: path.join(tmpDir, "corpus.json"),
        skipEmbeddings: true,
      };
      const both = await buildCorpus(opts);
      // Dirs sort con-first, so the con primary keeps "zoos" and the pro primary is renamed.
      expect(both.topics.map((t) => t.topic_id).sort()).toEqual([
        "zoos",
        "zoos__pro__p00__r1",
        "zoos__pro__p01__r1",
      ]);
      expect(both.topics.every((t) => t.topic_group_id === "zoos")).toBe(true);
      expect(new Set(both.topics.map((t) => t.injection_direction))).toEqual(new Set(["pro", "con"]));

      const pro = await buildCorpus({ ...opts, direction: "pro" });
      expect(pro.topics.map((t) => t.topic_id).sort()).toEqual(["zoos", "zoos__pro__p01__r1"]);
      expect(pro.topics.every((t) => t.topic_group_id === "zoos")).toBe(true);
      expect(pro.topics.every((t) => t.injection_direction === "pro")).toBe(true);

      const con = await buildCorpus({ ...opts, direction: "con" });
      expect(con.topics).toHaveLength(1);
      expect(con.topics[0]!.injection_direction).toBe("con");
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
