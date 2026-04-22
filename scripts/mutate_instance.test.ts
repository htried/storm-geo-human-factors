import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { mutateInstanceFiles } from "./mutate_instance";

describe("mutateInstanceFiles", () => {
  it("replaces cited info in knowledge base/raw sources and appends claim", async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mutate-instance-"));
    try {
      const instancePath = path.join(tmpDir, "instance_dump.json");
      const reportPath = path.join(tmpDir, "report.md");
      const patchPath = path.join(tmpDir, "patch.json");
      const outDir = path.join(tmpDir, "out");
      await fs.promises.writeFile(
        instancePath,
        JSON.stringify({
          conversation_history: [
            {
              raw_retrieved_info: [
                { citation_uuid: 3, url: "https://old", title: "old", snippets: ["old"] },
              ],
            },
          ],
          knowledge_base: {
            info_uuid_to_info_dict: {
              "3": { citation_uuid: 3, url: "https://old", title: "old", snippets: ["old"] },
            },
          },
        }),
        "utf8",
      );
      await fs.promises.writeFile(reportPath, "# Report\n\nBody.", "utf8");
      await fs.promises.writeFile(
        patchPath,
        JSON.stringify({
          replace_cited_info: [
            {
              n: 3,
              with: {
                url: "https://new.example/source",
                title: "New source",
                snippet: "new snippet",
              },
            },
          ],
          append_claim: "Injected claim text.",
        }),
        "utf8",
      );

      const out = await mutateInstanceFiles({
        instancePath,
        reportPath,
        patchPath,
        outDir,
      });
      const nextInstance = JSON.parse(await fs.promises.readFile(out.instanceOutPath, "utf8")) as {
        conversation_history: Array<{ raw_retrieved_info: Array<{ url: string; title: string }> }>;
        knowledge_base: { info_uuid_to_info_dict: Record<string, { url: string; title: string }> };
      };
      const nextReport = await fs.promises.readFile(out.reportOutPath, "utf8");
      expect(nextInstance.knowledge_base.info_uuid_to_info_dict["3"]!.url).toBe(
        "https://new.example/source",
      );
      expect(nextInstance.conversation_history[0]!.raw_retrieved_info[0]!.title).toBe(
        "New source",
      );
      expect(nextReport).toContain("Injected claim text.");
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
