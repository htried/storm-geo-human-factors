"use client";

import {
  PlaceholderCondition,
  type ConditionProps,
} from "./PlaceholderCondition";

export function InjectedSearch(props: ConditionProps) {
  return <PlaceholderCondition {...props} conditionLabel="Injected Search" />;
}
