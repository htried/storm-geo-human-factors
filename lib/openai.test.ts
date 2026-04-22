import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("openai", () => {
  class OpenAIMock {
    embeddings = { create: createMock };
    constructor(_opts: unknown) {}
  }
  return { default: OpenAIMock };
});

describe("embedQuery", () => {
  beforeEach(() => {
    vi.resetModules();
    createMock.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("calls embeddings.create and returns the first embedding", async () => {
    createMock.mockResolvedValue({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
    const { embedQuery } = await import("./openai");
    const out = await embedQuery("hello world", "text-embedding-3-small");
    expect(out).toEqual([0.1, 0.2, 0.3]);
    expect(createMock).toHaveBeenCalledWith({
      model: "text-embedding-3-small",
      input: "hello world",
    });
  });

  it("trims input and rejects empty strings", async () => {
    const { embedQuery } = await import("./openai");
    await expect(embedQuery("   ", "m")).rejects.toThrow(/non-empty/);
  });

  it("throws if OpenAI returns no vectors", async () => {
    createMock.mockResolvedValue({ data: [] });
    const { embedQuery } = await import("./openai");
    await expect(embedQuery("x", "m")).rejects.toThrow(/no embedding/i);
  });
});
