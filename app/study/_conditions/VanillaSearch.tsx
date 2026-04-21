"use client";

import {
  PlaceholderCondition,
  type ConditionProps,
} from "./PlaceholderCondition";

export function VanillaSearch(props: ConditionProps) {
  return <PlaceholderCondition {...props} conditionLabel="Vanilla Search" />;
}
