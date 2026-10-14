export interface Citation {
  n: number;
  url: string;
  title: string;
}

/**
 * Turn bare `[n]` citation markers into markdown links to the cited URL so
 * they render as real anchors. Markers already followed by `(` or `:` are
 * left alone (they're existing links / reference definitions), as are numbers
 * with no matching citation.
 */
export function linkifyCitations(markdown: string, citations: readonly Citation[]): string {
  if (citations.length === 0) return markdown;
  const byN = new Map(citations.map((c) => [c.n, c.url]));
  return markdown.replace(/\[(\d{1,3})\](?![(:])/g, (whole, digits: string) => {
    const url = byN.get(Number(digits));
    return url ? `[[${digits}]](${url} "citation")` : whole;
  });
}
