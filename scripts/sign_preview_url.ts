import { createPreviewToken } from "@/lib/preview-token";
import { CONDITIONS, type Condition } from "@/lib/assignment";

function usage(): never {
  throw new Error(
    "Usage: tsx scripts/sign_preview_url.ts <baseStudyUrl> <participant_id> <condition> [topic_id] [expires_hours=24]\n" +
      "Example: tsx scripts/sign_preview_url.ts https://study.example.com/study p123 injected_agent topic-a 24",
  );
}

function parseCondition(raw: string): Condition {
  if ((CONDITIONS as readonly string[]).includes(raw)) return raw as Condition;
  throw new Error(`invalid condition: ${raw}`);
}

async function main() {
  const base = process.argv[2];
  const participantId = process.argv[3];
  const conditionRaw = process.argv[4];
  const topicId = process.argv[5];
  const expiresHours = Number(process.argv[6] ?? "24");
  if (!base || !participantId || !conditionRaw) usage();
  if (!process.env.ADMIN_TOKEN) {
    throw new Error("ADMIN_TOKEN env var is required");
  }
  const condition = parseCondition(conditionRaw);
  const expiresAtUnixSec = Math.floor(Date.now() / 1000 + expiresHours * 60 * 60);
  const token = createPreviewToken({
    participantId,
    condition,
    secret: process.env.ADMIN_TOKEN,
    expiresAtUnixSec,
  });
  const u = new URL(base);
  u.searchParams.set("participant_id", participantId);
  u.searchParams.set("condition", condition);
  u.searchParams.set("token", token);
  if (topicId) u.searchParams.set("topic_id", topicId);
  console.log(u.toString());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
