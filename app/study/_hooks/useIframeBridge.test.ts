import { describe, it, expect, beforeEach } from "vitest";
import {
  setParentOrigin,
  __getParentOriginForTest,
} from "./useIframeBridge";

describe("setParentOrigin", () => {
  beforeEach(() => {
    setParentOrigin(null);
  });

  it("defaults to '*' when unset", () => {
    expect(__getParentOriginForTest()).toBe("*");
  });

  it("accepts a valid absolute origin", () => {
    setParentOrigin("https://surveys.example.com");
    expect(__getParentOriginForTest()).toBe("https://surveys.example.com");
  });

  it("normalizes to canonical origin (strips path/query)", () => {
    setParentOrigin("https://surveys.example.com/take?x=1");
    expect(__getParentOriginForTest()).toBe("https://surveys.example.com");
  });

  it("preserves port when present", () => {
    setParentOrigin("http://localhost:4000/path");
    expect(__getParentOriginForTest()).toBe("http://localhost:4000");
  });

  it("falls back to '*' on an invalid URL", () => {
    setParentOrigin("not a url");
    expect(__getParentOriginForTest()).toBe("*");
  });

  it("falls back to '*' on an empty string", () => {
    setParentOrigin("");
    expect(__getParentOriginForTest()).toBe("*");
  });

  it("falls back to '*' on explicit '*' input", () => {
    setParentOrigin("*");
    expect(__getParentOriginForTest()).toBe("*");
  });

  it("falls back to '*' on null", () => {
    setParentOrigin("https://first.example");
    expect(__getParentOriginForTest()).toBe("https://first.example");
    setParentOrigin(null);
    expect(__getParentOriginForTest()).toBe("*");
  });
});
