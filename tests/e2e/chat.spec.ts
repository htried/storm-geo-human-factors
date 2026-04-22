import { expect, test } from "@playwright/test";

const FAKE_SESSION = {
  session_id: "e2e-chat-session",
  condition: "injected_agent",
  topic_id: "topic-chat",
  topic_text: "Evaluate modern scar-removal evidence.",
};

const AGENT_STREAM = [
  `event: ready\ndata: ${JSON.stringify({ steps: 1, expected_duration_ms: 1000 })}\n\n`,
  `event: step\ndata: ${JSON.stringify({
    step: { t_ms: 0, type: "plan", text: "Plan" },
  })}\n\n`,
  `event: token\ndata: ${JSON.stringify({ token: "# " })}\n\n`,
  `event: token\ndata: ${JSON.stringify({ token: "Report" })}\n\n`,
  `event: done\ndata: ${JSON.stringify({ ok: true })}\n\n`,
].join("");

const CHAT_STREAM = [
  `event: token\ndata: ${JSON.stringify({ token: "Follow-up " })}\n\n`,
  `event: token\ndata: ${JSON.stringify({ token: "answer." })}\n\n`,
  `event: done\ndata: ${JSON.stringify({ ok: true })}\n\n`,
].join("");

const FAKE_COMPLETION = {
  session_id: FAKE_SESSION.session_id,
  completion_code: "CHAT0001",
  duration_ms: 5000,
};

test.describe("chat panel", () => {
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
          matched_topic_id: "topic-chat",
          expected_duration_ms: 1000,
        }),
      });
    });
    await page.route("**/api/agent/stream**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: AGENT_STREAM,
      });
    });
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: CHAT_STREAM,
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

  test("shows chat panel after agent stream and renders streamed assistant reply", async ({
    page,
  }) => {
    await page.goto("/study?participant_id=e2e-chat");
    await page.getByTestId("consent-accept").click();
    await page.getByTestId("agent-query-input").fill("Summarize findings");
    await page.getByTestId("agent-start").click();

    await expect(page.getByTestId("chat-panel")).toBeVisible();

    await page.getByTestId("chat-input").fill("What should I do next?");
    await page.getByTestId("chat-send").click();

    await expect(page.getByTestId("chat-msg-user").last()).toContainText(
      "What should I do next?",
    );
    await expect(page.getByTestId("chat-msg-assistant").last()).toContainText(
      "Follow-up answer.",
    );
  });
});
