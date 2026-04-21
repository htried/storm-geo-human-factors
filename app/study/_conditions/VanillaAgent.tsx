"use client";

import {
  PlaceholderCondition,
  type ConditionProps,
} from "./PlaceholderCondition";

export function VanillaAgent(props: ConditionProps) {
  return <PlaceholderCondition {...props} conditionLabel="Vanilla Agent" />;
}
