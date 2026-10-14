"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { z } from "zod";

import type { EventLogger } from "../_hooks/useEventLogger";
import {
  SearchResults,
  isMaliciousUrl,
  type SearchResultRow,
} from "./SearchResults";
import { SearchPagination } from "./SearchPagination";

const SearchApiResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      displayed_url: z.string(),
      snippet: z.string(),
      rank: z.number().int().nonnegative(),
    }),
  ),
  total_pages: z.number().int().positive(),
});

export type SearchApiResponse = z.infer<typeof SearchApiResponseSchema>;

export type SearchFetcher = (args: {
  session_id: string;
  query: string;
  page: number;
}) => Promise<SearchApiResponse>;

const defaultFetcher: SearchFetcher = async ({ session_id, query, page }) => {
  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_id, query, page }),
  });
  const raw: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (raw as { error?: string }).error ?? `search failed (${res.status})`;
    throw new Error(err);
  }
  const parsed = SearchApiResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("search returned an unexpected shape");
  }
  return parsed.data;
};

const DWELL_TICK_MS = 10_000;

interface Props {
  sessionId: string;
  topicText: string;
  logger: EventLogger;
  disabled?: boolean;
  onComplete: () => void | Promise<void>;
  /**
   * Overridable fetcher for tests/storybook. Defaults to POST /api/search.
   */
  fetcher?: SearchFetcher;
  /**
   * Injectable window.open for tests. Defaults to window.open.
   */
  openWindow?: (url: string) => void;
}

type State =
  | { kind: "idle" }
  | { kind: "loading"; query: string; page: number }
  | {
      kind: "loaded";
      query: string;
      page: number;
      results: SearchResultRow[];
      total_pages: number;
    }
  | { kind: "error"; query: string; page: number; message: string };

export function SearchView(props: Props) {
  const fetcher = useMemo(
    () => props.fetcher ?? defaultFetcher,
    [props.fetcher],
  );
  const openWindow = useMemo(
    () =>
      props.openWindow ??
      ((url: string) => {
        if (typeof window !== "undefined") {
          window.open(url, "_blank", "noopener,noreferrer");
        }
      }),
    [props.openWindow],
  );
  const [state, setState] = useState<State>({ kind: "idle" });
  const [input, setInput] = useState<string>("");
  const inFlightRef = useRef(0);

  const activeQuery = useMemo(() => {
    if (state.kind === "loading" || state.kind === "loaded" || state.kind === "error") {
      return state.query;
    }
    return null;
  }, [state]);

  const runSearch = useCallback(
    async (query: string, page: number) => {
      const myTicket = ++inFlightRef.current;
      setState({ kind: "loading", query, page });
      try {
        const data = await fetcher({
          session_id: props.sessionId,
          query,
          page,
        });
        if (myTicket !== inFlightRef.current) return;
        setState({
          kind: "loaded",
          query,
          page,
          results: data.results,
          total_pages: data.total_pages,
        });
      } catch (err) {
        if (myTicket !== inFlightRef.current) return;
        setState({
          kind: "error",
          query,
          page,
          message: err instanceof Error ? err.message : "search failed",
        });
      }
    },
    [fetcher, props.sessionId],
  );

  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const q = input.trim();
      if (!q) return;
      props.logger.log("query_submitted", { query: q, page: 1 });
      void runSearch(q, 1);
    },
    [input, props.logger, runSearch],
  );

  const handlePageChange = useCallback(
    (nextPage: number) => {
      if (activeQuery === null) return;
      const currentPage =
        state.kind === "loaded" || state.kind === "loading" || state.kind === "error"
          ? state.page
          : 1;
      if (nextPage === currentPage) return;
      props.logger.log("page_changed", { from: currentPage, to: nextPage });
      void runSearch(activeQuery, nextPage);
    },
    [activeQuery, props.logger, runSearch, state],
  );

  const handleResultClick = useCallback(
    (result: SearchResultRow) => {
      const is_malicious = isMaliciousUrl(result.url);
      props.logger.log("result_clicked", {
        rank: result.rank,
        url: result.url,
        is_malicious,
      });
      const href = is_malicious
        ? `${result.url}?session_id=${encodeURIComponent(props.sessionId)}`
        : result.url;
      openWindow(href);
    },
    [openWindow, props.logger, props.sessionId],
  );

  // Dwell ticker. Emits a delta tick every 10s while the tab is visible. We
  // intentionally don't carry accumulated time across visibility changes; we
  // just pause the timer when hidden and resume when visible. Analysis sums.
  useEffect(() => {
    if (typeof document === "undefined") return;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (intervalId !== null) return;
      intervalId = setInterval(() => {
        props.logger.log("dwell_tick", { seconds: DWELL_TICK_MS / 1000 });
      }, DWELL_TICK_MS);
    };
    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    if (document.visibilityState === "visible") start();

    const onChange = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    document.addEventListener("visibilitychange", onChange);
    return () => {
      document.removeEventListener("visibilitychange", onChange);
      stop();
    };
  }, [props.logger]);

  const loading = state.kind === "loading";

  return (
    <section className="space-y-6" data-testid="search-view">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold">Research task</h2>
        <div
          className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm"
          data-testid="search-topic"
        >
          {props.topicText}
        </div>
      </header>

      <form onSubmit={handleSubmit} className="flex gap-2" data-testid="search-form">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search"
          disabled={props.disabled || loading}
          className="flex-1 rounded-full border border-gray-300 px-4 py-2 outline-none focus:border-black"
          data-testid="search-input"
          aria-label="Search query"
        />
        <button
          type="submit"
          className="rounded-full bg-black px-5 py-2 text-white hover:bg-gray-800 disabled:bg-gray-400"
          disabled={props.disabled || loading || input.trim().length === 0}
          data-testid="search-submit"
        >
          Search
        </button>
      </form>

      {state.kind === "loading" && (
        <p className="text-sm text-gray-600" data-testid="search-loading">
          Searching…
        </p>
      )}

      {state.kind === "error" && (
        <div
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
          data-testid="search-error"
        >
          Search is temporarily unavailable. ({state.message}) Try again in a
          moment.
        </div>
      )}

      {state.kind === "loaded" && (
        <div className="space-y-6">
          <SearchResults
            results={state.results}
            onResultClick={handleResultClick}
          />
          <SearchPagination
            currentPage={state.page}
            totalPages={state.total_pages}
            disabled={props.disabled || loading}
            onPageChange={handlePageChange}
          />
        </div>
      )}

      <footer className="border-t border-gray-200 pt-4">
        <button
          type="button"
          className="rounded bg-black px-4 py-2 text-white hover:bg-gray-800 disabled:bg-gray-400"
          disabled={props.disabled}
          onClick={() => void props.onComplete()}
          data-testid="condition-finish"
        >
          I&apos;m done — finish
        </button>
      </footer>
    </section>
  );
}
