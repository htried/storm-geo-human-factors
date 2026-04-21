import { test, expect, type Route } from "@playwright/test";

/**
 * End-to-end coverage for the search condition: consent -> query -> 10
 * results -> click -> paginate. All API endpoints are stubbed with
 * page.route so this spec does not require a live Supabase / SERPER.
 *
 * Note on injected_search: the fake /api/search response below puts a
 * /ext/... URL at rank 3 so the client's isMaliciousUrl() derivation is
 * exercised without leaking injected_rank through the API.
 */

const FAKE_SESSION_INJECTED = {
  session_id: "e2e-search-session",
  condition: "injected_search",
  topic_id: "health_scars_seed",
  topic_text: "E2E: investigate scar-fading evidence.",
};

const FAKE_COMPLETION = {
  session_id: FAKE_SESSION_INJECTED.session_id,
  completion_code: "SEARCH01",
  duration_ms: 6789,
};

function makeSearchResponse(page: number) {
  const results = Array.from({ length: 10 }, (_, i) => {
    const rank = i;
    if (page === 1 && rank === 3) {
      return {
        title: "The Truth About Scars",
        url: `/ext/${FAKE_SESSION_INJECTED.topic_id}/truth-about-scars`,
        displayed_url: "example-health.org/truth-about-scars",
        snippet: "A landmark study you haven't been told about.",
        rank,
      };
    }
    return {
      title: `Result ${rank} (page ${page})`,
      url: `https://example.com/p${page}/r${rank}`,
      displayed_url: `example.com/p${page}/r${rank}`,
      snippet: `Snippet for rank ${rank} on page ${page}.`,
      rank,
    };
  });
  return { results, total_pages: 5 };
}

interface LoggedEvent {
  t_ms: number;
  type: string;
  payload?: Record<string, unknown>;
}

test.describe("search condition", () => {
  let eventsPosted: LoggedEvent[] = [];
  let searchCalls: Array<{ query: string; page: number }> = [];

  test.beforeEach(async ({ page }) => {
    eventsPosted = [];
    searchCalls = [];

    await page.route("**/api/session", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FAKE_SESSION_INJECTED),
      });
    });

    await page.route("**/api/events", async (route: Route) => {
      if (route.request().method() === "POST") {
        try {
          const body = JSON.parse(route.request().postData() ?? "{}") as {
            session_id?: string;
            events?: LoggedEvent[];
          };
          if (Array.isArray(body.events)) {
            for (const e of body.events) eventsPosted.push(e);
          }
        } catch {
          // ignore
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ inserted: 1 }),
        });
        return;
      }
      await route.fulfill({ status: 200, body: "{}" });
    });

    await page.route("**/api/search", async (route: Route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        query?: string;
        page?: number;
      };
      const q = typeof body.query === "string" ? body.query : "";
      const p = typeof body.page === "number" ? body.page : 1;
      searchCalls.push({ query: q, page: p });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeSearchResponse(p)),
      });
    });

    await page.route("**/api/complete", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FAKE_COMPLETION),
      });
    });

    // Capture window.open invocations without actually opening a new tab —
    // we want to observe the href the client chose for each click.
    await page.addInitScript(() => {
      const opens: string[] = [];
      (window as unknown as { __opens: string[] }).__opens = opens;
      (
        window as unknown as { open: (...args: unknown[]) => null }
      ).open = (url: unknown) => {
        opens.push(String(url));
        return null;
      };
    });
  });

  test("submits a query, renders 10 results, logs events on click, and paginates", async ({
    page,
  }) => {
    await page.goto(
      `/study?participant_id=e2e-search&parent_origin=${encodeURIComponent(
        "http://127.0.0.1",
      )}`,
    );

    await expect(page.getByTestId("consent-form")).toBeVisible();
    await page.getByTestId("consent-accept").click();

    await expect(page.getByTestId("search-view")).toBeVisible();
    await expect(page.getByTestId("search-topic")).toContainText(
      FAKE_SESSION_INJECTED.topic_text,
    );

    // Submit a query.
    await page.getByTestId("search-input").fill("scar fading evidence");
    await page.getByTestId("search-submit").click();

    // 10 cards land on page 1.
    const cards = page.getByTestId("search-result");
    await expect(cards).toHaveCount(10);

    // Exactly one of them should be the injected /ext result.
    const injected = page.locator(
      `[data-testid="search-result"][data-url^="/ext/${FAKE_SESSION_INJECTED.topic_id}/"]`,
    );
    await expect(injected).toHaveCount(1);

    // Click the injected result.
    await injected.click();

    // The client appended ?session_id=... before opening.
    const opens = await page.evaluate(
      () => (window as unknown as { __opens: string[] }).__opens,
    );
    expect(opens.length).toBeGreaterThan(0);
    const openedUrl = opens[0]!;
    expect(openedUrl).toContain(`/ext/${FAKE_SESSION_INJECTED.topic_id}/`);
    expect(openedUrl).toContain(
      `session_id=${encodeURIComponent(FAKE_SESSION_INJECTED.session_id)}`,
    );

    // Events should include query_submitted and result_clicked. The logger
    // buffers and batches, so we give it a beat to flush before asserting.
    await expect
      .poll(() => eventsPosted.map((e) => e.type))
      .toEqual(expect.arrayContaining(["query_submitted", "result_clicked"]));

    const clickEvent = eventsPosted.find((e) => e.type === "result_clicked")!;
    expect(clickEvent.payload).toMatchObject({
      rank: 3,
      is_malicious: true,
    });
    expect(String(clickEvent.payload?.url)).toContain(
      `/ext/${FAKE_SESSION_INJECTED.topic_id}/`,
    );

    // Paginate.
    await page.getByTestId("search-page").filter({ hasText: "2" }).click();
    await expect(cards).toHaveCount(10);
    expect(searchCalls.some((c) => c.page === 2)).toBe(true);

    await expect
      .poll(() => eventsPosted.map((e) => e.type))
      .toEqual(expect.arrayContaining(["page_changed"]));

    const pageChange = eventsPosted.find((e) => e.type === "page_changed")!;
    expect(pageChange.payload).toMatchObject({ from: 1, to: 2 });

    // Finish still works and reaches the completion screen.
    await page.getByTestId("condition-finish").click();
    await expect(page.getByTestId("completion-screen")).toBeVisible();
    await expect(page.getByTestId("completion-code")).toHaveText(
      FAKE_COMPLETION.completion_code,
    );
  });
});
