import { createHmac } from "node:crypto";

import { CONDITIONS, type Condition } from "./conditions";

export {
  AGENT_CONDITIONS,
  CONDITIONS,
  injectionDirectionOf,
  isAgentCondition,
  isInjectedCondition,
  type Condition,
} from "./conditions";

/**
 * Deterministically assign a participant to one of `enabled` (defaults to all
 * conditions). Changing the enabled set changes the mapping for *new*
 * participants only; existing sessions are persisted and re-read.
 */
export function assignCondition(
  participantId: string,
  secret: string,
  enabled: readonly Condition[] = CONDITIONS,
): Condition {
  if (enabled.length === 0) throw new Error("assignCondition: no enabled conditions");
  const hmac = createHmac("sha256", secret).update(participantId).digest();
  const idx = hmac.readUInt32BE(0) % enabled.length;
  return enabled[idx]!;
}
