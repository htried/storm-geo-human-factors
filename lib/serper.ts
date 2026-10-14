import { z } from "zod";
import { isMockMode, mockSearchResults } from "./mock";

const SERPER_URL = "https://google.serper.dev/search";

export interface SerperSearchResult {
  title: string;
  url: string;
  displayed_url: string;
  snippet: string;
  rank: number;
}

const OrganicEntrySchema = z
  .object({
    title: z.string(),
    link: z.string(),
    snippet: z.string().optional().default(""),
    displayedLink: z.string().optional(),
  })
  .passthrough();

const SerperResponseSchema = z
  .object({
    organic: z.array(OrganicEntrySchema).optional().default([]),
  })
  .passthrough();

function safeHost(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.host;
  } catch {
    return null;
  }
}

export interface SearchSerperArgs {
  query: string;
  page: number;
}

export interface SearchSerperOutput {
  results: SerperSearchResult[];
}

export async function searchSerper(
  args: SearchSerperArgs,
): Promise<SearchSerperOutput> {
  const { query, page } = args;
  if (!Number.isInteger(page) || page < 1) {
    throw new Error(`searchSerper: invalid page ${page}; must be an integer >= 1`);
  }
  if (isMockMode()) {
    return { results: mockSearchResults(query, page) };
  }
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error("searchSerper: SERPER_API_KEY is not set");
  }

  const url = new URL(SERPER_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("page", String(page));
  url.searchParams.set("num", "10");
  url.searchParams.set("apiKey", apiKey);

  const res = await fetch(url.toString(), { method: "GET" });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `SERPER request failed: ${res.status} ${res.statusText}${
        text ? ` — ${text.slice(0, 200)}` : ""
      }`,
    );
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch (err) {
    throw new Error(
      `SERPER returned non-JSON body: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const parsed = SerperResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `SERPER response failed validation: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ")}`,
    );
  }

  const results: SerperSearchResult[] = [];
  for (const entry of parsed.data.organic) {
    const host = safeHost(entry.link);
    if (!host) continue;
    results.push({
      title: entry.title,
      url: entry.link,
      displayed_url: entry.displayedLink && entry.displayedLink.length > 0 ? entry.displayedLink : host,
      snippet: entry.snippet ?? "",
      rank: results.length,
    });
  }

  return { results };
}

export function __resetSerperForTest(): void {
  // placeholder for future module-level state (none today)
}
