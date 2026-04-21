"use client";

import { SearchView } from "../_components/SearchView";
import type { ConditionProps } from "./PlaceholderCondition";

export function InjectedSearch(props: ConditionProps) {
  return (
    <SearchView
      sessionId={props.sessionId}
      topicText={props.topicText}
      logger={props.logger}
      disabled={props.disabled}
      onComplete={props.onComplete}
    />
  );
}
