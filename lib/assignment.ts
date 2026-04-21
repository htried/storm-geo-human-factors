import { createHmac } from "node:crypto";

export const CONDITIONS = [
  "vanilla_search",
  "injected_search",
  "vanilla_agent",
  "injected_agent",
] as const;

export type Condition = (typeof CONDITIONS)[number];

export function assignCondition(participantId: string, secret: string): Condition {
  const hmac = createHmac("sha256", secret).update(participantId).digest();
  const idx = hmac.readUInt32BE(0) % CONDITIONS.length;
  return CONDITIONS[idx]!;
}
