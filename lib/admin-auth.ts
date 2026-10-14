import { createHash, timingSafeEqual } from "node:crypto";
import { loadEnv } from "./env";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Constant-time string comparison (hash first so lengths always match). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function hasAdminBearer(req: Request): boolean {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  return safeEqual(auth.slice("Bearer ".length), loadEnv().ADMIN_TOKEN);
}

/**
 * Gate for /api/admin/*. Returns a Response to short-circuit with, or null if
 * the caller is allowed through. When ADMIN_API_ENABLED is off the endpoints
 * 404 so they aren't discoverable; researchers read data through the
 * database console (behind institutional SSO/MFA) instead.
 */
export function requireAdmin(req: Request): Response | null {
  const env = loadEnv();
  if (!env.ADMIN_API_ENABLED) return json(404, { error: "not found" });
  if (!hasAdminBearer(req)) return json(401, { error: "unauthorized" });
  return null;
}
