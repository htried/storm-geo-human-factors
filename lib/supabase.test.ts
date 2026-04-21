import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getSupabase, __resetSupabaseForTest } from "./supabase";
import { __resetEnvForTest } from "./env";

describe("getSupabase", () => {
  const orig = { ...process.env };
  beforeEach(() => {
    process.env = { ...orig };
    __resetEnvForTest();
    __resetSupabaseForTest();
    Object.assign(process.env, {
      SERPER_API_KEY: "x",
      OPENAI_API_KEY: "x",
      SUPABASE_URL: "http://localhost:54321",
      SUPABASE_SERVICE_ROLE_KEY: "x-long-enough",
      ASSIGN_SECRET: "x-long-enough",
      INJECT_SECRET: "x-long-enough",
      ADMIN_TOKEN: "x-long-enough",
      IP_HASH_SALT: "x-long-enough",
      ALLOWED_FRAME_ANCESTORS: "*",
    });
  });
  afterEach(() => {
    process.env = orig;
    __resetEnvForTest();
    __resetSupabaseForTest();
  });

  it("returns a client instance", () => {
    const c = getSupabase();
    expect(c).toBeDefined();
    expect(typeof c.from).toBe("function");
  });

  it("returns the same instance on repeat calls (singleton)", () => {
    const a = getSupabase();
    const b = getSupabase();
    expect(a).toBe(b);
  });
});
