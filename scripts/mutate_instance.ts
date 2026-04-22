import fs from "node:fs";
import path from "node:path";

interface ReplaceCitationPatch {
  n: number;
  with: {
    url: string;
    title: string;
    snippet?: string;
    description?: string;
  };
}

interface MutationPatch {
  replace_cited_info?: ReplaceCitationPatch[];
  append_claim?: string;
}

interface RawSource {
  citation_uuid?: number;
  url?: string;
  title?: string;
  description?: string;
  snippets?: string[];
}

interface RawTurn {
  raw_retrieved_info?: RawSource[];
}

interface RawInstanceDump {
  conversation_history?: RawTurn[];
  warmstart_conv_archive?: RawTurn[];
  knowledge_base?: {
    info_uuid_to_info_dict?: Record<string, RawSource>;
  };
}

function applyCitationReplacements(instance: RawInstanceDump, patch: MutationPatch): void {
  const replaces = patch.replace_cited_info ?? [];
  if (replaces.length === 0) return;

  const kb = instance.knowledge_base?.info_uuid_to_info_dict ?? {};
  for (const r of replaces) {
    const key = String(r.n);
    const prev = kb[key] ?? { citation_uuid: r.n };
    kb[key] = {
      ...prev,
      citation_uuid: r.n,
      url: r.with.url,
      title: r.with.title,
      description: r.with.description ?? r.with.snippet ?? prev.description ?? "",
      snippets:
        r.with.snippet && r.with.snippet.length > 0
          ? [r.with.snippet]
          : prev.snippets ?? [],
    };
  }
  if (instance.knowledge_base) {
    instance.knowledge_base.info_uuid_to_info_dict = kb;
  }

  const turns = [
    ...(instance.warmstart_conv_archive ?? []),
    ...(instance.conversation_history ?? []),
  ];
  const byN = new Map(replaces.map((r) => [r.n, r]));
  for (const turn of turns) {
    const arr = turn.raw_retrieved_info;
    if (!Array.isArray(arr)) continue;
    for (const src of arr) {
      const n = src.citation_uuid;
      if (typeof n !== "number") continue;
      const rep = byN.get(n);
      if (!rep) continue;
      src.url = rep.with.url;
      src.title = rep.with.title;
      if (rep.with.description) src.description = rep.with.description;
      if (rep.with.snippet) src.snippets = [rep.with.snippet];
    }
  }
}

export async function mutateInstanceFiles(args: {
  instancePath: string;
  reportPath: string;
  patchPath: string;
  outDir: string;
}): Promise<{ instanceOutPath: string; reportOutPath: string }> {
  const [instanceRaw, reportRaw, patchRaw] = await Promise.all([
    fs.promises.readFile(args.instancePath, "utf8"),
    fs.promises.readFile(args.reportPath, "utf8"),
    fs.promises.readFile(args.patchPath, "utf8"),
  ]);
  const instance = JSON.parse(instanceRaw) as RawInstanceDump;
  const patch = JSON.parse(patchRaw) as MutationPatch;

  applyCitationReplacements(instance, patch);

  let report = reportRaw;
  if (patch.append_claim && patch.append_claim.trim().length > 0) {
    report = `${report.trimEnd()}\n\n## Additional Claim\n${patch.append_claim.trim()}\n`;
  }

  await fs.promises.mkdir(args.outDir, { recursive: true });
  const instanceOutPath = path.join(args.outDir, "instance_dump.json");
  const reportOutPath = path.join(args.outDir, "report.md");
  await Promise.all([
    fs.promises.writeFile(instanceOutPath, JSON.stringify(instance, null, 2), "utf8"),
    fs.promises.writeFile(reportOutPath, report, "utf8"),
  ]);
  return { instanceOutPath, reportOutPath };
}

async function main() {
  const instancePath = process.argv[2];
  const reportPath = process.argv[3];
  const patchPath = process.argv[4];
  const outDir = process.argv[5] ?? path.join(process.cwd(), "mutated_out");
  if (!instancePath || !reportPath || !patchPath) {
    throw new Error(
      "Usage: tsx scripts/mutate_instance.ts <instance_dump.json> <report.md> <patch.json> [out_dir]",
    );
  }
  await mutateInstanceFiles({ instancePath, reportPath, patchPath, outDir });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
