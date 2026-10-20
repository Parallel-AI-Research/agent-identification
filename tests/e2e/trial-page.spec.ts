import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const api = "http://127.0.0.1:4310";
const siteId = "agent-trials";
// Local fixture configuration only; never use this known value for a hosted site.
const siteSecret = "test-only-secret-not-for-production-00000001";

interface Session {
  sessionId: string;
  siteId: string;
  choice: string | null;
}

function nextSession(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.url() === `${api}/v1/sessions` &&
      response.request().method() === "POST" &&
      response.status() === 201,
  );
}

async function load(page: Page, path = "/trial/"): Promise<Session> {
  const created = nextSession(page);
  await page.goto(`${api}${path}`);
  const session = (await (await created).json()) as Session;
  await expect(page.getByRole("button", { name: "Person", exact: true })).toBeEnabled();
  return session;
}

async function events(request: APIRequestContext, sessionId: string) {
  const response = await request.get(`${api}/v1/events?siteId=${siteId}&limit=1000`, {
    headers: { Authorization: `Bearer ${siteSecret}` },
  });
  expect(response.status()).toBe(200);
  const data = (await response.json()) as {
    events: Array<{ sessionId: string; choice: string; siteId: string }>;
  };
  return data.events.filter((event) => event.sessionId === sessionId);
}

async function isGated(page: Page) {
  return page.locator("#announcement-form").evaluate((element) => (element as HTMLElement).inert);
}

test("landing retains installation instructions and links to the clean trial", async ({ page }) => {
  const session = await load(page, "/");
  expect(session.siteId).toBe("public-demo");
  await expect(page.locator("#install-code")).toContainText("data-site");
  await expect(page.locator("#package-code")).toContainText("npm install");
  await expect(page.getByRole("button", { name: "Copy snippet", exact: true })).toBeVisible();
  const links = await page
    .locator("a[href]")
    .evaluateAll((elements) => elements.map((element) => (element as HTMLAnchorElement).href));
  expect(links).toContain(`${api}/trial/`);
});

test("trial presents an ordinary task without installation or experiment controls", async ({
  page,
}) => {
  const session = await load(page);
  expect(session.siteId).toBe(siteId);
  await expect(page.locator("#announcement-form")).toBeVisible();
  await expect(page.locator("pre, code")).toHaveCount(0);
  const ordinaryText = await page.locator("body").evaluate((body) => {
    const clone = body.cloneNode(true) as HTMLElement;
    clone.querySelector("#visitor-choice")?.remove();
    clone.querySelectorAll("script, style").forEach((element) => element.remove());
    return clone.textContent ?? "";
  });
  expect(ordinaryText).not.toMatch(
    /\b(?:install|npm|SDK|research|experiment|trial|collector|optional mode|required mode|new session|reset declaration)\b/i,
  );
  const links = await page
    .locator("a[href]")
    .evaluateAll((elements) => elements.map((element) => (element as HTMLAnchorElement).href));
  expect(links).not.toEqual(
    expect.arrayContaining([expect.stringMatching(/github\.com|\/downloads\/|\/sdk\/|\?mode=/)]),
  );
  await expect(page.locator("#announcement-preview")).toBeHidden();
});

test("required trial accepts an acknowledged choice before enabling a text-only preview", async ({
  page,
  request,
}) => {
  const session = await load(page);
  expect(await isGated(page)).toBe(true);
  expect(await events(request, session.sessionId)).toHaveLength(0);

  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${api}/v1/declarations`, async (route) => {
    await held;
    await route.continue();
  });
  await page.getByRole("button", { name: "Prefer not to say", exact: true }).click();
  expect(await isGated(page)).toBe(true);
  await expect(page.locator("#announcement-preview")).toBeHidden();
  release();
  await expect(
    page.getByText("Response recorded: Prefer not to say.", { exact: true }),
  ).toBeVisible();
  expect(await isGated(page)).toBe(false);

  const headline = '<img src=x onerror="document.body.dataset.injected=1">';
  const body = "<script>document.body.dataset.injected=1</script>\nA plain-text announcement.";
  await page.locator('[name="headline"]').fill(headline);
  await page.locator('[name="body"]').fill(body);
  await page.getByRole("button", { name: "Preview announcement", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Announcement preview", exact: true }),
  ).toBeVisible();
  const preview = page.locator("#announcement-preview");
  await expect(preview).toContainText(headline);
  await expect(preview).toContainText(body);
  await expect(preview.locator("img, script")).toHaveCount(0);
  expect(await page.locator("body").getAttribute("data-injected")).toBeNull();
  expect(await events(request, session.sessionId)).toEqual([
    expect.objectContaining({ siteId, choice: "prefer_not_to_say" }),
  ]);
});

test("optional trial completes its task without auto-submitting identification", async ({
  page,
  request,
}) => {
  let declarations = 0;
  page.on("request", (incoming) => {
    if (incoming.url() === `${api}/v1/declarations` && incoming.method() === "POST") {
      declarations += 1;
    }
  });
  const session = await load(page, "/trial/?mode=optional");
  expect(await isGated(page)).toBe(false);
  await page.locator('[name="headline"]').fill("Office hours moved to Thursday");
  await page.locator('[name="body"]').fill("Join us at 3 pm in the usual room.");
  await page.getByRole("button", { name: "Preview announcement", exact: true }).click();
  await expect(page.locator("#announcement-preview")).toContainText(
    "Office hours moved to Thursday",
  );
  expect(declarations).toBe(0);
  expect(await events(request, session.sessionId)).toHaveLength(0);
});

test("trial does not inherit the landing declaration and starts fresh on reload", async ({
  page,
  request,
}) => {
  const landing = await load(page, "/");
  await page.getByRole("button", { name: "Person", exact: true }).click();
  await expect(page.getByText("Response recorded: Person.", { exact: true })).toBeVisible();

  const trial = await load(page);
  expect(trial.siteId).toBe(siteId);
  expect(trial.sessionId).not.toBe(landing.sessionId);
  expect(trial.choice).toBeNull();
  expect(await isGated(page)).toBe(true);
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  await expect(page.getByText("Response recorded: AI assistant.", { exact: true })).toBeVisible();
  const created = nextSession(page);
  await page.reload();
  const fresh = (await (await created).json()) as Session;
  expect(fresh.siteId).toBe(siteId);
  expect(fresh.sessionId).not.toBe(trial.sessionId);
  expect(fresh.choice).toBeNull();
  await expect(page.getByRole("button", { name: "AI assistant", exact: true })).toBeEnabled();
  expect(await isGated(page)).toBe(true);
  expect(await events(request, fresh.sessionId)).toHaveLength(0);
  expect(await events(request, trial.sessionId)).toHaveLength(1);
});

test("required trial stays blocked when identification cannot load", async ({ page }) => {
  await page.route(`${api}/v1/sessions`, (route) => route.abort("failed"));
  await page.goto(`${api}/trial/`);
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  expect(await isGated(page)).toBe(true);
  await expect(page.locator("#announcement-preview")).toBeHidden();
});

test("missing SDK leaves the task unavailable instead of bypassing the required choice", async ({
  page,
}) => {
  await page.route(`${api}/sdk/v0.1.0/agent-id.js`, (route) => route.abort("failed"));
  await page.goto(`${api}/trial/`);
  await expect(page.locator("#page-status")).toBeVisible();
  await expect(page.locator("#announcement-form")).toBeHidden();
  await expect(page.locator("#announcement-preview")).toBeHidden();
});
