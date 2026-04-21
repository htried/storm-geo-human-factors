import { randomBytes } from "node:crypto";

// 32 uppercase alphanumerics excluding confusable chars O, 0, I, 1.
// Length is a power of two so a single byte % 32 is uniformly distributed.
export const COMPLETION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const CODE_LENGTH = 8;

export function generateCompletionCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += COMPLETION_CODE_ALPHABET[bytes[i]! % COMPLETION_CODE_ALPHABET.length];
  }
  return out;
}
