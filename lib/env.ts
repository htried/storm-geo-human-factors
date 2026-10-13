import { z } from "zod";
import { CONDITIONS, type Condition } from "./assignment";

/** Empty env values should behave as unset so `.default()` applies (not `""` or `0`). */
const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

/**
 * Default study arms: the two AI-overview (agent) conditions only. The
 * traditional-search arms stay in the codebase and can be re-enabled by
 * listing them in ENABLED_CONDITIONS.
 */
export const DEFAULT_ENABLED_CONDITIONS: readonly Condition[] = [
  "vanilla_agent",
  "injected_agent",
];

const EnabledConditionsSchema = z.preprocess(
  (v) => {
    if (v === undefined || v === "") return undefined;
    if (typeof v !== "string") return v;
    const list = v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from(new Set(list));
  },
  z
    .array(z.enum(CONDITIONS))
    .min(1)
    .default([...DEFAULT_ENABLED_CONDITIONS]),
);

const BoolFlag = z.preprocess(
  (v) => (typeof v === "string" ? ["1", "true", "yes"].includes(v.toLowerCase()) : v),
  z.boolean().default(false),
);

const Schema = z
  .object({
    SERPER_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    OPENAI_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    ASSIGN_SECRET: z.string().min(8),
    INJECT_SECRET: z.string().min(8),
    ADMIN_TOKEN: z.string().min(8),
    IP_HASH_SALT: z.string().min(8),
    ALLOWED_FRAME_ANCESTORS: z.string().min(1),
    ENABLED_CONDITIONS: EnabledConditionsSchema,
    /** Serve canned agent/chat output instead of calling OpenAI/SERPER. */
    MOCK_EXTERNAL_APIS: BoolFlag,
    /** Expose /api/admin/* over HTTP. Off by default; use the DB console instead. */
    ADMIN_API_ENABLED: BoolFlag,
    CHAT_MODEL: z.preprocess(emptyToUndefined, z.string().default("gpt-4o-mini")),
    CHAT_TEMPERATURE: z.preprocess(emptyToUndefined, z.coerce.number().default(0.3)),
    CHAT_MAX_TOKENS: z.preprocess(emptyToUndefined, z.coerce.number().int().default(800)),
    EMBEDDING_MODEL: z.preprocess(emptyToUndefined, z.string().default("text-embedding-3-small")),
  })
  .superRefine((env, ctx) => {
    if (env.MOCK_EXTERNAL_APIS) return;
    if (!env.OPENAI_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["OPENAI_API_KEY"],
        message: "required unless MOCK_EXTERNAL_APIS=1",
      });
    }
    const searchEnabled = env.ENABLED_CONDITIONS.some((c) => c.endsWith("_search"));
    if (searchEnabled && !env.SERPER_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["SERPER_API_KEY"],
        message: "required when a *_search condition is enabled (unless MOCK_EXTERNAL_APIS=1)",
      });
    }
  });

export type AppEnv = z.infer<typeof Schema>;

let cached: AppEnv | null = null;

export function loadEnv(): AppEnv {
  if (cached) return cached;
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid or missing env vars: ${missing}`);
  }
  if (process.env.NODE_ENV === "production" && parsed.data.ADMIN_TOKEN.length < 32) {
    throw new Error("Invalid or missing env vars: ADMIN_TOKEN (must be >= 32 chars in production)");
  }
  cached = parsed.data;
  return cached;
}

export function __resetEnvForTest() { cached = null; }
