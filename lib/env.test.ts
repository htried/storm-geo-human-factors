import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEnv, __resetEnvForTest } from "./env";

describe("loadEnv", () => {
  const orig = { ...process.env };
  beforeEach(() => { process.env = { ...orig }; __resetEnvForTest(); });
  afterEach(() => { process.env = orig; __resetEnvForTest(); });

  it("throws a descriptive error when required vars missing", () => {
    delete process.env.SERPER_API_KEY;
    expect(() => loadEnv()).toThrow(/SERPER_API_KEY/);
  });

  it("returns defaults for model config when not set", () => {
    Object.assign(process.env, {
      SERPER_API_KEY: "x", OPENAI_API_KEY: "x",
      SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "x",
      ASSIGN_SECRET: "x-long-enough", INJECT_SECRET: "x-long-enough", ADMIN_TOKEN: "x-long-enough",
      IP_HASH_SALT: "x-long-enough", ALLOWED_FRAME_ANCESTORS: "*",
    });
    const env = loadEnv();
    expect(env.CHAT_MODEL).toBe("gpt-4o-mini");
    expect(env.EMBEDDING_MODEL).toBe("text-embedding-3-small");
    expect(env.CHAT_TEMPERATURE).toBeCloseTo(0.3);
    expect(env.CHAT_MAX_TOKENS).toBe(800);
  });
});
