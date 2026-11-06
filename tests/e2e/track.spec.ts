import { expect, test, type APIRequestContext, type Page, type Response } from "@playwright/test";

const api = "http://127.0.0.1:4310";
const siteId = "demo-site";
// Local fixture configuration only; never use this known value for a hosted site.
const siteSecret = "test-only-secret-not-for-production-00000001";

/** Loads the page and returns the session it started, or null if it reused the tab's. */
async function load(page: Page, path = "/track/") {
  // A page view is only sent once its session exists, so any new session arrives first.
  const sessions: Promise<string>[] = [];
  const listener = (response: Response) => {
    if (response.url() === `${api}/v1/sessions` && response.request().method() === "POST") {
      sessions.push(response.json().then((body: { sessionId: string }) => body.sessionId));
    }
  };
  page.on("response", listener);
  const viewed = page.waitForResponse(
    (response) => response.url() === `${api}/v1/page-views` && response.status() === 200,
  );
  await page.goto(path);
  await viewed;
  page.off("response", listener);
  return (await Promise.all(sessions))[0] ?? null;
}

async function activity(request: APIRequestContext, sessionId: string, type: string) {
  const response = await request.get(
    `${api}/v1/activity?siteId=${siteId}&type=${type}&sessionId=${sessionId}&limit=100`,
    { headers: { Authorization: `Bearer ${siteSecret}` } },
  );
  expect(response.status()).toBe(200);
  return (
    (await response.json()) as {
      events: Array<{ path?: string; signal?: string; evidence: string; origin: string }>;
    }
  ).events;
}

test("the page script records a page view and adds nothing to the page", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const html = await (await request.get("http://127.0.0.1:4311/track/")).text();
  const sessionId = await load(page, "/track/?ref=newsletter");
  expect(sessionId).not.toBeNull();
  expect(await activity(request, sessionId!, "page_view")).toEqual([
    expect.objectContaining({
      path: "/track/",
      evidence: "browser_reported",
      origin: "http://127.0.0.1:4311",
    }),
  ]);
  // The body is exactly what the server sent: no element, shadow root or style was added.
  const served = await page.evaluate((source) => {
    const parsed = new DOMParser().parseFromString(source, "text/html");
    const shadows = [...document.querySelectorAll("*")].filter((node) => node.shadowRoot).length;
    return {
      same: parsed.body.innerHTML.trim() === document.body.innerHTML.trim(),
      head: document.head.children.length === parsed.head.children.length,
      shadows,
    };
  }, html);
  expect(served).toEqual({ same: true, head: true, shadows: 0 });
  expect(errors).toEqual([]);
});

test("an automated browser is reported once per session, as a signal and never an agent", async ({
  page,
  request,
}) => {
  const sessionId = await load(page);
  const automated = await page.evaluate(() => navigator.webdriver);
  await expect
    .poll(async () => (await activity(request, sessionId!, "signal")).length)
    .toBe(automated ? 1 : 0);
  if (automated) {
    expect(await activity(request, sessionId!, "signal")).toEqual([
      expect.objectContaining({ signal: "webdriver", evidence: "browser_reported" }),
    ]);
  }
  await page.reload();
  await expect.poll(async () => (await activity(request, sessionId!, "page_view")).length).toBe(2);
  expect(await activity(request, sessionId!, "signal")).toHaveLength(automated ? 1 : 0);
});

test("changing pages without a reload records each new path in the tab's session", async ({
  page,
  request,
}) => {
  const sessionId = await load(page);
  await page.getByRole("link", { name: "Pricing" }).click();
  await expect(page).toHaveURL(/\/track\/pricing$/);
  await page.getByRole("link", { name: "Ticket 42" }).click();
  await expect.poll(async () => (await activity(request, sessionId!, "page_view")).length).toBe(3);
  await page.goBack();
  await expect(page).toHaveURL(/\/track\/pricing$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/track\/$/);
  await expect.poll(async () => (await activity(request, sessionId!, "page_view")).length).toBe(5);
  const paths = (await activity(request, sessionId!, "page_view")).map((view) => view.path);
  // Newest first. The ticket's ID is masked.
  expect(paths).toEqual([
    "/track/",
    "/track/pricing",
    "/track/tickets/:id",
    "/track/pricing",
    "/track/",
  ]);

  // A reload keeps the tab's session without asking for a new one.
  expect(await load(page)).toBeNull();
  await expect.poll(async () => (await activity(request, sessionId!, "page_view")).length).toBe(6);

  // Another tab starts its own.
  const other = await load(await page.context().newPage());
  expect(other).not.toBeNull();
  expect(other).not.toBe(sessionId);
});

test("when the collector can't be reached the page stays the same and listeners hear why", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { heard: string[] }).heard = [];
    document.addEventListener("agent-identification:error", (event) =>
      (window as unknown as { heard: string[] }).heard.push(
        (event as CustomEvent<{ message: string }>).detail.message,
      ),
    );
  });
  await page.route(`${api}/v1/sessions`, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 503, body: "{}", contentType: "application/json" })
      : route.continue(),
  );
  await page.goto("/track/");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { heard: string[] }).heard))
    .toEqual(["Identification service returned HTTP 503."]);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("main")).toContainText("A little progress, shared.");
});
