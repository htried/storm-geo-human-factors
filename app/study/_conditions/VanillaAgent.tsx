"use client";

import { AgentView } from "../_components/AgentView";
import type { ConditionProps } from "./PlaceholderCondition";

export function VanillaAgent(props: ConditionProps) {
  return (
    <AgentView
      sessionId={props.sessionId}
      topicText={props.topicText}
      logger={props.logger}
      disabled={props.disabled}
      onComplete={props.onComplete}
    />
  );
}
