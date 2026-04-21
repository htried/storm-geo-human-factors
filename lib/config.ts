import { loadEnv } from "./env";
import { getSupabase } from "./supabase";

export interface AppConfig {
  chat_model: string;
  chat_temperature: number;
  chat_max_tokens: number;
  embedding_model: string;
}

const CACHE_TTL_MS = 30_000;

let cached: { value: AppConfig; fetchedAt: number } | null = null;
let pending: Promise<AppConfig> | null = null;

function envDefaults(): AppConfig {
  const env = loadEnv();
  return {
    chat_model: env.CHAT_MODEL,
    chat_temperature: env.CHAT_TEMPERATURE,
    chat_max_tokens: env.CHAT_MAX_TOKENS,
    embedding_model: env.EMBEDDING_MODEL,
  };
}

async function fetchAppConfig(): Promise<AppConfig> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("app_config")
      .select("chat_model, chat_temperature, chat_max_tokens, embedding_model")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      console.warn(
        `[app_config] DB fetch failed, falling back to env defaults: ${error.message}`,
      );
      return envDefaults();
    }
    if (!data) {
      console.warn(
        "[app_config] no row with id=1 present; falling back to env defaults",
      );
      return envDefaults();
    }
    return {
      chat_model: data.chat_model,
      chat_temperature: data.chat_temperature,
      chat_max_tokens: data.chat_max_tokens,
      embedding_model: data.embedding_model,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[app_config] unexpected error, falling back to env defaults: ${msg}`,
    );
    return envDefaults();
  }
}

export async function getAppConfig(): Promise<AppConfig> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value;
  }
  if (pending) return pending;

  pending = fetchAppConfig()
    .then((value) => {
      cached = { value, fetchedAt: Date.now() };
      return value;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

export function __resetAppConfigForTest() {
  cached = null;
  pending = null;
}
