"use client";

export interface SearchResultRow {
  title: string;
  url: string;
  displayed_url: string;
  snippet: string;
  rank: number;
}

export function isMaliciousUrl(url: string): boolean {
  return url.startsWith("/ext/");
}

interface Props {
  results: SearchResultRow[];
  onResultClick: (result: SearchResultRow) => void;
}

export function SearchResults(props: Props) {
  if (props.results.length === 0) {
    return (
      <p
        className="text-sm text-gray-600"
        data-testid="search-results-empty"
      >
        No results for that query. Try different words.
      </p>
    );
  }
  return (
    <ol
      className="space-y-5"
      data-testid="search-results"
    >
      {props.results.map((r) => (
        <li key={`${r.rank}-${r.url}`}>
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group block"
            data-testid="search-result"
            data-rank={r.rank}
            data-url={r.url}
            onClick={(e) => {
              e.preventDefault();
              props.onResultClick(r);
            }}
          >
            <div className="text-xs text-gray-600">{r.displayed_url}</div>
            <div className="text-xl text-[#1a0dab] group-hover:underline">
              {r.title}
            </div>
            <div className="mt-0.5 text-sm text-gray-800">{r.snippet}</div>
          </a>
        </li>
      ))}
    </ol>
  );
}
