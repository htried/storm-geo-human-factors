import { StudyClient } from "./StudyClient";

export const dynamic = "force-dynamic";

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

  return (
    <StudyClient
      initialParticipantId={participantId}
      initialTopicId={topicId}
      parentOrigin={parentOrigin}
    />
  );
}
