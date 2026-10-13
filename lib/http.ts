/**
 * Internal error text (Postgres messages, etc.) is useful while developing but
 * shouldn't reach participants' browsers in production. Log it server-side
 * and omit it from the response.
 */
export function errDetail(message: string | undefined): string | undefined {
  if (process.env.NODE_ENV !== "production") return message;
  if (message) console.error(`[api] ${message}`);
  return undefined;
}
