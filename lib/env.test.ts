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

  it("treats empty-string CHAT_TEMPERATURE as default 0.3", () => {
    Object.assign(process.env, {
      SERPER_API_KEY: "x", OPENAI_API_KEY: "x",
      SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "x",
      ASSIGN_SECRET: "x-long-enough", INJECT_SECRET: "x-long-enough", ADMIN_TOKEN: "x-long-enough",
      IP_HASH_SALT: "x-long-enough", ALLOWED_FRAME_ANCESTORS: "*",
      CHAT_TEMPERATURE: "",
    });
    const env = loadEnv();
    expect(env.CHAT_TEMPERATURE).toBeCloseTo(0.3);
  });

  it("treats empty-string EMBEDDING_MODEL as default 'text-embedding-3-small'", () => {
    Object.assign(process.env, {
      SERPER_API_KEY: "x", OPENAI_API_KEY: "x",
      SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "x",
      ASSIGN_SECRET: "x-long-enough", INJECT_SECRET: "x-long-enough", ADMIN_TOKEN: "x-long-enough",
      IP_HASH_SALT: "x-long-enough", ALLOWED_FRAME_ANCESTORS: "*",
      EMBEDDING_MODEL: "",
    });
    const env = loadEnv();
    expect(env.EMBEDDING_MODEL).toBe("text-embedding-3-small");
  });

  it("rejects invalid SUPABASE_URL", () => {
    Object.assign(process.env, {
      SERPER_API_KEY: "x", OPENAI_API_KEY: "x",
      SUPABASE_URL: "not-a-url", SUPABASE_SERVICE_ROLE_KEY: "x",
      ASSIGN_SECRET: "x-long-enough", INJECT_SECRET: "x-long-enough", ADMIN_TOKEN: "x-long-enough",
      IP_HASH_SALT: "x-long-enough", ALLOWED_FRAME_ANCESTORS: "*",
    });
    expect(() => loadEnv()).toThrow(/SUPABASE_URL/);
  });
});
