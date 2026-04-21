"use client";

import {
  PlaceholderCondition,
  type ConditionProps,
} from "./PlaceholderCondition";

export function InjectedAgent(props: ConditionProps) {
  return <PlaceholderCondition {...props} conditionLabel="Injected Agent" />;
}
