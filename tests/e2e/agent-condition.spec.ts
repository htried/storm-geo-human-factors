import { expect, test } from "@playwright/test";

const FAKE_SESSION = {
  session_id: "e2e-agent-session",
  condition: "vanilla_agent",
  topic_id: "topic-agent",
  topic_text: "Assess treatment options for old scar tissue.",
};

const FAKE_COMPLETION = {
  session_id: FAKE_SESSION.session_id,
  completion_code: "AGENT001",
  duration_ms: 3210,
};

const STREAM_BODY = [
  `event: ready\ndata: ${JSON.stringify({ steps: 2, expected_duration_ms: 2000 })}\n\n`,
  `event: step\ndata: ${JSON.stringify({
    step: { t_ms: 0, type: "plan", text: "Planning research steps." },
  })}\n\n`,
  `event: step\ndata: ${JSON.stringify({
    step: { t_ms: 500, type: "search", query: "scar treatment evidence" },
  })}\n\n`,
  `event: token\ndata: ${JSON.stringify({ token: "# " })}\n\n`,
  `event: token\ndata: ${JSON.stringify({ token: "Findings" })}\n\n`,
  `event: token\ndata: ${JSON.stringify({ token: "\\nModern options include laser and microneedling." })}\n\n`,
  `event: done\ndata: ${JSON.stringify({ ok: true })}\n\n`,
].join("");

test.describe("agent condition", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/session", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FAKE_SESSION),
      });
    });
    await page.route("**/api/events", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ inserted: 1 }),
      });
    });
    await page.route("**/api/agent/start", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          stream_url: `/api/agent/stream?session_id=${encodeURIComponent(FAKE_SESSION.session_id)}`,
          matched_topic_id: "topic-agent",
          expected_duration_ms: 2000,
        }),
      });
    });
    await page.route("**/api/agent/stream**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: STREAM_BODY,
      });
    });
    await page.route("**/api/complete", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FAKE_COMPLETION),
      });
    });
  });

  test("renders activity steps and streamed report content", async ({ page }) => {
    await page.goto("/study?participant_id=e2e-agent");
    await page.getByTestId("consent-accept").click();

    await expect(page.getByTestId("agent-view")).toBeVisible();
    await page.getByTestId("agent-query-input").fill("What treatments are most effective?");
    await page.getByTestId("agent-start").click();

    await expect(page.getByTestId("agent-step")).toHaveCount(2);
    await expect(page.getByTestId("agent-report")).toContainText("Findings");

    await page.getByTestId("condition-finish").click();
    await expect(page.getByTestId("completion-screen")).toBeVisible();
  });
});
