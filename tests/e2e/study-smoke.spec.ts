import { test, expect } from "@playwright/test";

/**
 * Smoke test for the /study page flow. The three API routes are intercepted
 * with page.route() so the test does not require a live Supabase — the
 * server-side routes are covered by unit tests in app/api/**.
 */

const FAKE_SESSION = {
  session_id: "e2e-session-0001",
  condition: "vanilla_search",
  topic_id: "topic-e2e",
  topic_text: "E2E topic prompt: please evaluate these results.",
};

const FAKE_COMPLETION = {
  session_id: FAKE_SESSION.session_id,
  completion_code: "ABCD2345",
  duration_ms: 4321,
};

test.describe("study smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/session", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FAKE_SESSION),
      });
    });
    await page.route("**/api/events", async (route) => {
      const json =
        route.request().method() === "POST"
          ? JSON.parse(route.request().postData() ?? "{}")
          : {};
      const inserted = Array.isArray(json.events) ? json.events.length : 0;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ inserted }),
      });
    });
    await page.route("**/api/complete", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FAKE_COMPLETION),
      });
    });

    // Install the postMessage capture BEFORE the page runs so we catch every
    // message — resize, heartbeat, and study_complete. Uses `addInitScript`
    // so it runs in every navigated document before app scripts.
    await page.addInitScript(() => {
      const store: unknown[] = [];
      (window as unknown as { __msgs: unknown[] }).__msgs = store;
      window.addEventListener("message", (e) => {
        store.push(e.data);
      });
    });
  });

  test("loading -> consent with topic -> active condition -> complete, and a study_complete postMessage is dispatched to the parent", async ({
    page,
  }) => {
    await page.goto("/study?participant_id=test-e2e");

    // Session is fetched on mount. Consent form appears after the /api/session
    // response, with the topic text rendered on it.
    await expect(page.getByTestId("consent-form")).toBeVisible();
    await expect(page.getByTestId("consent-topic")).toContainText(
      FAKE_SESSION.topic_text,
    );

    await page.getByTestId("consent-accept").click();

    await expect(page.getByText("Vanilla Search")).toBeVisible();

    await page.getByTestId("condition-finish").click();

    await expect(page.getByTestId("completion-screen")).toBeVisible();
    await expect(page.getByTestId("completion-code")).toHaveText(
      FAKE_COMPLETION.completion_code,
    );

    // Core contract for the iframe bridge: a study_complete message with the
    // expected payload must have been dispatched to window.parent. The capture
    // is installed in addInitScript above, so messages posted during the
    // entire flow are collected.
    const msgs = await page.evaluate(
      () => (window as unknown as { __msgs: unknown[] }).__msgs,
    );
    const complete = (
      msgs as Array<{
        source?: string;
        type?: string;
        participant_id?: string;
        completion_code?: string;
        duration_ms?: number;
      }>
    ).find(
      (m) => m?.source === "storm-study" && m?.type === "study_complete",
    );
    expect(complete, "expected a study_complete postMessage").toBeDefined();
    expect(complete!.participant_id).toBe("test-e2e");
    expect(complete!.completion_code).toBe(FAKE_COMPLETION.completion_code);
    expect(complete!.duration_ms).toBe(FAKE_COMPLETION.duration_ms);
  });

  test("shows an error panel if participant_id is missing", async ({
    page,
  }) => {
    await page.goto("/study");
    await expect(page.getByTestId("error-panel")).toBeVisible();
    await expect(page.getByTestId("consent-form")).not.toBeVisible();
  });
});
