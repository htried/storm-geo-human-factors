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
  });

  test("consent → active condition → complete with code", async ({ page }) => {
    await page.goto("/study?participant_id=test-e2e");
    await expect(page.getByTestId("consent-form")).toBeVisible();

    const postMessageCapture = page.evaluate(() => {
      (window as unknown as { __msgs: unknown[] }).__msgs = [];
      window.addEventListener("message", (e) => {
        (window as unknown as { __msgs: unknown[] }).__msgs.push(e.data);
      });
    });
    await postMessageCapture;

    await page.getByTestId("consent-accept").click();

    await expect(page.getByText("Vanilla Search")).toBeVisible();
    await expect(
      page.getByText(FAKE_SESSION.topic_text, { exact: false }),
    ).toBeVisible();

    await page.getByRole("button", { name: /finish/i }).click();

    await expect(page.getByTestId("completion-screen")).toBeVisible();
    await expect(page.getByTestId("completion-code")).toHaveText(
      FAKE_COMPLETION.completion_code,
    );
  });

  test("shows an error if participant_id is missing", async ({ page }) => {
    await page.goto("/study");
    await expect(page.getByTestId("consent-form")).toBeVisible();
    await expect(page.getByTestId("consent-accept")).toBeDisabled();
  });
});
