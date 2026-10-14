import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEnv, __resetEnvForTest } from "./env";

describe("loadEnv", () => {
  const orig = { ...process.env };
  beforeEach(() => { process.env = { ...orig }; __resetEnvForTest(); });
  afterEach(() => { process.env = orig; __resetEnvForTest(); });

  const BASE = {
    SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "x",
    ASSIGN_SECRET: "x-long-enough", INJECT_SECRET: "x-long-enough", ADMIN_TOKEN: "x-long-enough",
    IP_HASH_SALT: "x-long-enough", ALLOWED_FRAME_ANCESTORS: "*",
  };
  const clearOptional = () => {
    for (const k of ["SERPER_API_KEY", "OPENAI_API_KEY", "ENABLED_CONDITIONS", "MOCK_EXTERNAL_APIS", "ADMIN_API_ENABLED"]) {
      delete process.env[k];
    }
  };

  it("throws a descriptive error when required vars missing", () => {
    delete process.env.SUPABASE_URL;
    expect(() => loadEnv()).toThrow(/SUPABASE_URL/);
  });

  it("defaults ENABLED_CONDITIONS to the two agent arms", () => {
    clearOptional();
    Object.assign(process.env, BASE, { OPENAI_API_KEY: "x" });
    const env = loadEnv();
    expect(env.ENABLED_CONDITIONS).toEqual(["vanilla_agent", "injected_agent"]);
    expect(env.MOCK_EXTERNAL_APIS).toBe(false);
    expect(env.ADMIN_API_ENABLED).toBe(false);
  });

  it("parses ENABLED_CONDITIONS and rejects unknown names", () => {
    clearOptional();
    Object.assign(process.env, BASE, {
      OPENAI_API_KEY: "x", SERPER_API_KEY: "x",
      ENABLED_CONDITIONS: " vanilla_search, injected_agent ,vanilla_search",
    });
    expect(loadEnv().ENABLED_CONDITIONS).toEqual(["vanilla_search", "injected_agent"]);
    __resetEnvForTest();
    process.env.ENABLED_CONDITIONS = "vanilla_agent,bogus";
    expect(() => loadEnv()).toThrow(/ENABLED_CONDITIONS/);
  });

  it("requires SERPER_API_KEY only when a search arm is enabled", () => {
    clearOptional();
    Object.assign(process.env, BASE, { OPENAI_API_KEY: "x" });
    expect(() => loadEnv()).not.toThrow();
    __resetEnvForTest();
    process.env.ENABLED_CONDITIONS = "vanilla_search,vanilla_agent";
    expect(() => loadEnv()).toThrow(/SERPER_API_KEY/);
  });

  it("does not require OpenAI/SERPER keys in mock mode", () => {
    clearOptional();
    Object.assign(process.env, BASE, {
      MOCK_EXTERNAL_APIS: "1",
      ENABLED_CONDITIONS: "vanilla_search,injected_agent",
    });
    expect(loadEnv().MOCK_EXTERNAL_APIS).toBe(true);
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
