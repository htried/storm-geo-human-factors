/**
 * Pre-deploy check for a grouped (pro/con) corpus: every study topic has runs for every
 * enabled agent arm, and every injected run cites a /ext/ landing page that resolves to
 * that run's own side. Exits 1 on any problem.
 *
 *   npx tsx scripts/verify_corpus.ts [corpus.json] [--arms vanilla_agent,injected_agent_pro,...]
 */
import { loadCorpus, groupCandidates, studyTopicIds, topicGroupId } from "@/lib/corpus";
import { injectionDirectionOf, isInjectedCondition } from "@/lib/conditions";

async function main() {
  const args = process.argv.slice(2);
  const armsIdx = args.indexOf("--arms");
  const arms = (armsIdx >= 0 ? args[armsIdx + 1]! : "vanilla_agent,injected_agent_pro,injected_agent_con").split(",");
  const corpusPath = args.find((a, i) => !a.startsWith("--") && i !== armsIdx + 1) ?? "app/data/corpus.procon.json";
  const c = await loadCorpus(corpusPath);
  const problems: string[] = [];
  const ids = studyTopicIds(c);
  console.log(`${corpusPath}: ${c.topics.length} entries, study topics: ${ids.join(", ")}`);
  for (const id of ids) {
    const topic = c.topics.find((t) => t.topic_id === id)!;
    const counts: string[] = [];
    for (const arm of arms) {
      const cands = groupCandidates(c, topicGroupId(topic), injectionDirectionOf(arm));
      counts.push(`${arm}=${cands.length}`);
      if (cands.length === 0) problems.push(`${id}: no runs for ${arm}`);
      if (!isInjectedCondition(arm)) continue;
      for (const cand of cands) {
        const ext = cand.injected_timeline.citations.filter((x) => x.url.startsWith("/ext/"));
        if (ext.length === 0) problems.push(`${cand.topic_id}: injected report cites no /ext/ source`);
        for (const x of ext) {
          const [, , group, slug] = x.url.split("/");
          const pages = c.topics.filter(
            (t) => topicGroupId(t) === group && t.malicious_source.url_slug === slug,
          );
          const sides = new Set(pages.map((t) => t.injection_direction));
          if (pages.length === 0) problems.push(`${cand.topic_id}: ${x.url} resolves to no landing page`);
          else if (sides.size !== 1 || !sides.has(cand.injection_direction))
            problems.push(`${cand.topic_id}: ${x.url} resolves to the wrong side (${[...sides].join("/")})`);
        }
      }
    }
    console.log(`  ${id}: ${counts.join(", ")}`);
  }
  for (const p of problems.slice(0, 50)) console.log(`PROBLEM ${p}`);
  console.log(problems.length === 0 ? "OK" : `${problems.length} problems`);
  if (problems.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
