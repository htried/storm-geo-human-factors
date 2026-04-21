import { z } from "zod";

const Schema = z.object({
  SERPER_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ASSIGN_SECRET: z.string().min(8),
  INJECT_SECRET: z.string().min(8),
  ADMIN_TOKEN: z.string().min(8),
  IP_HASH_SALT: z.string().min(8),
  ALLOWED_FRAME_ANCESTORS: z.string().min(1),
  CHAT_MODEL: z.string().default("gpt-4o-mini"),
  CHAT_TEMPERATURE: z.coerce.number().default(0.3),
  CHAT_MAX_TOKENS: z.coerce.number().int().default(800),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
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
  cached = parsed.data;
  return cached;
}

export function __resetEnvForTest() { cached = null; }
