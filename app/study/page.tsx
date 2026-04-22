import { StudyClient } from "./StudyClient";

export const dynamic = "force-dynamic";

const CONDITIONS = [
  "vanilla_search",
  "injected_search",
  "vanilla_agent",
  "injected_agent",
] as const;
type Condition = (typeof CONDITIONS)[number];

function isCondition(value: string): value is Condition {
  return (CONDITIONS as readonly string[]).includes(value);
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
    typeof sp.condition === "string" && isCondition(sp.condition)
      ? sp.condition
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
    />
  );
}
