import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetSerperForTest, searchSerper } from "./serper";

const ENV = {
  SERPER_API_KEY: "test-serper-key",
};

function installFetchMock(handler: (input: RequestInfo, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn(handler);
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("searchSerper", () => {
  beforeEach(() => {
    __resetSerperForTest();
    for (const k of Object.keys(ENV)) {
      process.env[k] = ENV[k as keyof typeof ENV];
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts to SERPER with the right headers and body, mapping organic results", async () => {
    const fetchMock = installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          organic: [
            {
              title: "Scar types",
              link: "https://example.com/scars",
              snippet: "An overview of scar types.",
              displayedLink: "example.com › scars",
            },
            {
              title: "Another",
              link: "https://other.example/article?x=1",
              snippet: "Body.",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const out = await searchSerper({ query: "types of scars", page: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://google.serper.dev/search");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-api-key")).toBe("test-serper-key");
    expect(headers.get("content-type")).toBe("application/json");

    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ q: "types of scars", num: 10, start: 0 });

    expect(out.results).toEqual([
      {
        title: "Scar types",
        url: "https://example.com/scars",
        displayed_url: "example.com › scars",
        snippet: "An overview of scar types.",
        rank: 0,
      },
      {
        title: "Another",
        url: "https://other.example/article?x=1",
        displayed_url: "other.example",
        snippet: "Body.",
        rank: 1,
      },
    ]);
  });

  it("computes start offset from page number for pagination", async () => {
    const fetchMock = installFetchMock(async () => {
      return new Response(JSON.stringify({ organic: [] }), { status: 200 });
    });

    await searchSerper({ query: "hello", page: 3 });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ q: "hello", num: 10, start: 20 });
  });

  it("returns an empty results array when organic is missing or empty", async () => {
    installFetchMock(async () => {
      return new Response(JSON.stringify({}), { status: 200 });
    });
    const out = await searchSerper({ query: "x", page: 1 });
    expect(out.results).toEqual([]);

    installFetchMock(async () => {
      return new Response(JSON.stringify({ organic: [] }), { status: 200 });
    });
    const out2 = await searchSerper({ query: "x", page: 1 });
    expect(out2.results).toEqual([]);
  });

  it("throws on non-2xx SERPER responses", async () => {
    installFetchMock(async () => {
      return new Response("upstream error", { status: 500 });
    });
    await expect(searchSerper({ query: "x", page: 1 })).rejects.toThrow(/SERPER/);
  });

  it("throws when SERPER returns a malformed shape", async () => {
    installFetchMock(async () => {
      return new Response(
        JSON.stringify({ organic: [{ title: 123, link: "not-a-url" }] }),
        { status: 200 },
      );
    });
    await expect(searchSerper({ query: "x", page: 1 })).rejects.toThrow(/SERPER/);
  });

  it("rejects invalid page values early", async () => {
    await expect(searchSerper({ query: "x", page: 0 })).rejects.toThrow(/page/);
    await expect(searchSerper({ query: "x", page: -1 })).rejects.toThrow(/page/);
    await expect(searchSerper({ query: "x", page: 1.5 })).rejects.toThrow(/page/);
  });

  it("skips organic entries with a non-http link rather than failing the whole call", async () => {
    installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          organic: [
            { title: "Good", link: "https://ok.example/p", snippet: "ok" },
            { title: "Bad", link: "javascript:alert(1)", snippet: "danger" },
          ],
        }),
        { status: 200 },
      );
    });
    const out = await searchSerper({ query: "x", page: 1 });
    expect(out.results.map((r) => r.url)).toEqual(["https://ok.example/p"]);
    expect(out.results[0]!.rank).toBe(0);
  });
});
