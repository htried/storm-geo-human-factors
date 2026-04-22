import { createHmac, timingSafeEqual } from "node:crypto";

import type { Condition } from "./assignment";

function payload(participantId: string, condition: Condition, expUnixSec: number): string {
  return `${participantId}|${condition}|${expUnixSec}`;
}

function sign(secret: string, msg: string): string {
  return createHmac("sha256", secret).update(msg).digest("hex");
}

export function createPreviewToken(args: {
  participantId: string;
  condition: Condition;
  secret: string;
  expiresAtUnixSec: number;
}): string {
  const exp = Math.floor(args.expiresAtUnixSec);
  const sig = sign(args.secret, payload(args.participantId, args.condition, exp));
  return `${exp}.${sig}`;
}

export function verifyPreviewToken(args: {
  participantId: string;
  condition: Condition;
  secret: string;
  token: string;
  nowUnixSec?: number;
}): boolean {
  const [expRaw, sig] = args.token.split(".");
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || !sig) return false;
  const now = Math.floor(args.nowUnixSec ?? Date.now() / 1000);
  if (exp < now) return false;
  const expected = sign(args.secret, payload(args.participantId, args.condition, exp));
  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
