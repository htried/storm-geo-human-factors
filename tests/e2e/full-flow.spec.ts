import { expect, test } from "@playwright/test";

type Condition =
  | "vanilla_search"
  | "injected_search"
  | "vanilla_agent"
  | "injected_agent";

const CONDITIONS: Condition[] = [
  "vanilla_search",
  "injected_search",
  "vanilla_agent",
  "injected_agent",
];

function searchResults(condition: Condition) {
  return Array.from({ length: 10 }, (_, i) => ({
    title: `Result ${i}`,
    url:
      condition === "injected_search" && i === 2
        ? "/ext/topic-fullflow/malicious"
        : `https://example.com/r${i}`,
    displayed_url: `example.com/r${i}`,
    snippet: `Snippet ${i}`,
    rank: i,
  }));
}

for (const condition of CONDITIONS) {
  test(`full-flow ${condition}`, async ({ page }) => {
    const participantId = `p-${condition}`;
    const sessionId = `sess-${condition}`;
    const completionCode = `${condition.slice(0, 4).toUpperCase()}23A`;
    const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    const chats: Array<{ role: string; content: string }> = [];
    let sawOverride = false;
    let sawTokenQuery = false;

    await page.route("**/api/session**", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}");
      if (body.condition_override === condition) sawOverride = true;
      const url = new URL(route.request().url());
      if (url.searchParams.get("token")) sawTokenQuery = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session_id: sessionId,
          condition,
          topic_id: "topic-fullflow",
          topic_text: `Topic for ${condition}`,
        }),
      });
    });

    await page.route("**/api/events", async (route) => {
      if (route.request().method() === "POST") {
        const body = JSON.parse(route.request().postData() ?? "{}");
        if (Array.isArray(body.events)) {
          for (const ev of body.events) events.push(ev);
        }
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ inserted: 1 }),
      });
    });

    await page.route("**/api/search", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}");
      const pageNum = Number(body.page ?? 1);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: searchResults(condition).map((r) => ({ ...r, rank: r.rank + (pageNum - 1) * 10 })),
          total_pages: 5,
        }),
      });
    });

    await page.route("**/api/agent/start", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          stream_url: `/api/agent/stream?session_id=${encodeURIComponent(sessionId)}`,
          matched_topic_id: "topic-fullflow",
          expected_duration_ms: 1000,
        }),
      });
    });

    await page.route("**/api/agent/stream**", async (route) => {
      const body = [
        `event: ready\ndata: ${JSON.stringify({ steps: 1, expected_duration_ms: 1000 })}\n\n`,
        `event: step\ndata: ${JSON.stringify({
          step: { t_ms: 0, type: "plan", text: "Plan" },
        })}\n\n`,
        `event: token\ndata: ${JSON.stringify({ token: "# " })}\n\n`,
        `event: token\ndata: ${JSON.stringify({ token: "Report" })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ ok: true })}\n\n`,
      ].join("");
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body,
      });
    });

    await page.route("**/api/chat", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}");
      chats.push({ role: "user", content: body.user_message ?? "" });
      chats.push({ role: "assistant", content: "Stub assistant response." });
      const stream = [
        `event: token\ndata: ${JSON.stringify({ token: "Stub " })}\n\n`,
        `event: token\ndata: ${JSON.stringify({ token: "assistant response." })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ ok: true })}\n\n`,
      ].join("");
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: stream,
      });
    });

    await page.route("**/api/complete", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session_id: sessionId,
          completion_code: completionCode,
          duration_ms: 4321,
        }),
      });
    });

    await page.route("**/api/admin/session_summary**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session: {
            session_id: sessionId,
            participant_id: participantId,
            condition,
            topic_id: "topic-fullflow",
            completion_code: completionCode,
          },
          event_count: events.length,
          events_by_type: events.reduce<Record<string, number>>((acc, ev) => {
            acc[ev.type] = (acc[ev.type] ?? 0) + 1;
            return acc;
          }, {}),
          chat_message_count: chats.length,
        }),
      });
    });

    await page.addInitScript(() => {
      const msgs: unknown[] = [];
      (window as unknown as { __msgs: unknown[] }).__msgs = msgs;
      window.addEventListener("message", (e) => msgs.push(e.data));
      const opens: string[] = [];
      (window as unknown as { __opens: string[] }).__opens = opens;
      (window as unknown as { open: (...args: unknown[]) => null }).open = (url: unknown) => {
        opens.push(String(url));
        return null;
      };
    });

    await page.goto(
      `/study?participant_id=${encodeURIComponent(participantId)}&condition=${condition}&token=test-signed-token`,
    );
    await expect(page.getByTestId("consent-form")).toBeVisible();
    await page.getByTestId("consent-accept").click();

    if (condition === "vanilla_search" || condition === "injected_search") {
      await expect(page.getByTestId("search-view")).toBeVisible();
      await page.getByTestId("search-input").fill("scar treatment");
      await page.getByTestId("search-submit").click();
      await expect(page.getByTestId("search-result")).toHaveCount(10);
      await page.getByTestId("search-result").first().click();
    } else {
      await expect(page.getByTestId("agent-view")).toBeVisible();
      await page.getByTestId("agent-query-input").fill("Summarize findings");
      await page.getByTestId("agent-start").click();
      await expect(page.getByTestId("agent-step")).toHaveCount(1);
      await expect(page.getByTestId("agent-report")).toContainText("Report");
      await expect(page.getByTestId("chat-panel")).toBeVisible();
      await page.getByTestId("chat-input").fill("Any caveats?");
      await page.getByTestId("chat-send").click();
      await expect(page.getByTestId("chat-msg-assistant").last()).toContainText(
        "Stub assistant response.",
      );
    }

    await page.getByTestId("condition-finish").click();
    await expect(page.getByTestId("completion-screen")).toBeVisible();
    await expect(page.getByTestId("completion-code")).toHaveText(completionCode);

    const msgs = await page.evaluate(
      () => (window as unknown as { __msgs: unknown[] }).__msgs,
    );
    const complete = (
      msgs as Array<{ source?: string; type?: string; completion_code?: string }>
    ).find((m) => m.source === "storm-study" && m.type === "study_complete");
    expect(complete).toBeDefined();
    expect(complete!.completion_code).toBe(completionCode);

    const summary = (await page.evaluate(
      async ({ sid }) => {
        const r = await fetch(
          `/api/admin/session_summary?session_id=${encodeURIComponent(sid)}`,
          {
            headers: { authorization: "Bearer admin-token-12345" },
          },
        );
        return {
          ok: r.ok,
          body: await r.json(),
        };
      },
      { sid: sessionId },
    )) as {
      ok: boolean;
      body: {
        session: { condition: Condition; completion_code: string };
        event_count: number;
        chat_message_count: number;
      };
    };
    expect(summary.ok).toBe(true);
    const summaryBody = summary.body;
    const parsed = summaryBody as {
      session: { condition: Condition; completion_code: string };
      event_count: number;
      chat_message_count: number;
    };
    expect(parsed.session.condition).toBe(condition);
    expect(parsed.session.completion_code).toBe(completionCode);
    expect(parsed.event_count).toBeGreaterThan(0);
    if (condition === "vanilla_agent" || condition === "injected_agent") {
      expect(parsed.chat_message_count).toBeGreaterThan(0);
    }

    expect(sawOverride).toBe(true);
    expect(sawTokenQuery).toBe(true);
  });
}
