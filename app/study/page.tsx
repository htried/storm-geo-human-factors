import { StudyClient } from "./StudyClient";
import { CONDITIONS, type Condition } from "@/lib/assignment";

export const dynamic = "force-dynamic";

function isCondition(v: unknown): v is Condition {
  return typeof v === "string" && (CONDITIONS as readonly string[]).includes(v);
}

export default async function StudyPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await props.searchParams;
  const participantId =
    typeof sp.participant_id === "string" ? sp.participant_id : "";
  const topicId =
    typeof sp.topic_id === "string" && sp.topic_id.length > 0
      ? sp.topic_id
      : undefined;
  const parentOrigin =
    typeof sp.parent_origin === "string" && sp.parent_origin.length > 0
      ? sp.parent_origin
      : undefined;
  const conditionOverride =
    isCondition(sp.condition) ? sp.condition : undefined;
  // `eligible` is present-but-empty when the participant has no eligible
  // topic; absent when the embedder doesn't use eligibility at all.
  const eligibleTopics =
    typeof sp.eligible === "string"
      ? sp.eligible
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined;
  const previewToken =
    typeof sp.token === "string" && sp.token.length > 0 ? sp.token : undefined;

  return (
    <StudyClient
      initialParticipantId={participantId}
      initialTopicId={topicId}
      parentOrigin={parentOrigin}
      initialConditionOverride={conditionOverride}
      previewToken={previewToken}
      eligibleTopics={eligibleTopics}
    />
  );
}
