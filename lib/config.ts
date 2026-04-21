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

function envDefaults(): AppConfig {
  const env = loadEnv();
  return {
    chat_model: env.CHAT_MODEL,
    chat_temperature: env.CHAT_TEMPERATURE,
    chat_max_tokens: env.CHAT_MAX_TOKENS,
    embedding_model: env.EMBEDDING_MODEL,
  };
}

export async function getAppConfig(): Promise<AppConfig> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  let value: AppConfig;
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("app_config")
      .select("chat_model, chat_temperature, chat_max_tokens, embedding_model")
      .eq("id", 1)
      .maybeSingle();

    if (error || !data) {
      value = envDefaults();
    } else {
      value = {
        chat_model: data.chat_model,
        chat_temperature: data.chat_temperature,
        chat_max_tokens: data.chat_max_tokens,
        embedding_model: data.embedding_model,
      };
    }
  } catch {
    value = envDefaults();
  }

  cached = { value, fetchedAt: Date.now() };
  return value;
}

export function __resetAppConfigForTest() {
  cached = null;
}
