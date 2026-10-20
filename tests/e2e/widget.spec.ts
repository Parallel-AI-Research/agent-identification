import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const api = "http://127.0.0.1:4310";
const siteId = "demo-site";
// Local fixture configuration only; never use this known value for a hosted site.
const siteSecret = "test-only-secret-not-for-production-00000001";
const choices = [
  ["AI assistant", "ai_assistant"],
  ["Person", "person"],
  ["Prefer not to say", "prefer_not_to_say"],
] as const;

async function load(page: Page, path = "/plain/") {
  const created = page.waitForResponse(
    (response) =>
      response.url() === `${api}/v1/sessions` &&
      response.request().method() === "POST" &&
      response.status() === 201,
  );
  await page.goto(path);
  const session = (await (await created).json()) as { sessionId: string };
  await expect(page.getByRole("button", { name: "AI assistant", exact: true })).toBeEnabled();
  return session.sessionId;
}

async function events(request: APIRequestContext, sessionId: string) {
  const response = await request.get(`${api}/v1/events?siteId=${siteId}&limit=1000`, {
    headers: { Authorization: `Bearer ${siteSecret}` },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    events: Array<{ sessionId: string; choice: string; origin: string; evidence: string }>;
  };
  return body.events.filter((event) => event.sessionId === sessionId);
}

async function isGated(page: Page) {
  return page.locator("#publish-form").evaluate((element) => (element as HTMLElement).inert);
}

test("one script can append its own widget and infer the collector origin", async ({
  page,
  request,
}) => {
  // This server variant strips demo lifecycle code and optional configuration.
  // The shipped IIFE must work from the script tag alone.
  const sessionId = await load(page, "/plain/?snippet=minimal");
  expect(await isGated(page)).toBe(true);
  await expect(page.getByRole("button", { name: "AI assistant", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  await expect(page.getByText("Response recorded: AI assistant.", { exact: true })).toBeVisible();
  expect(await events(request, sessionId)).toHaveLength(1);
  expect(await isGated(page)).toBe(false);
});

for (const [label, choice] of choices) {
  test(`required script acknowledges ${choice} across origins before unlocking`, async ({
    page,
    request,
  }) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") violations.push(message.text());
    });
    const sessionId = await load(page);
    await expect.poll(() => isGated(page)).toBe(true);
    expect(await events(request, sessionId)).toHaveLength(0);

    const accepted = page.waitForResponse(`${api}/v1/declarations`);
    await page.getByRole("button", { name: label, exact: true }).click();
    expect((await accepted).status()).toBe(200);
    await expect(page.getByText(`Response recorded: ${label}.`, { exact: true })).toBeVisible();
    await expect.poll(() => isGated(page)).toBe(false);
    expect(await events(request, sessionId)).toEqual([
      expect.objectContaining({
        choice,
        origin: "http://127.0.0.1:4311",
        evidence: "self_reported",
      }),
    ]);
    await page.getByLabel("Headline").fill("Quarterly launch is ready");
    await page.getByRole("button", { name: "Publish update", exact: true }).click();
    await expect(page.getByText("Update published locally. No content was sent.")).toBeVisible();
    expect(
      violations.filter((error) =>
        /content security policy|refused to load|unsafe-inline/i.test(error),
      ),
    ).toEqual([]);
  });
}

test("optional script leaves the host form usable without submitting a declaration", async ({
  page,
  request,
}) => {
  const sessionId = await load(page, "/plain/?mode=optional");
  expect(await isGated(page)).toBe(false);
  await page.getByLabel("Headline").fill("A human or agent can leave the choice unanswered");
  await page.getByRole("button", { name: "Publish update", exact: true }).click();
  expect(await events(request, sessionId)).toHaveLength(0);
});

test("keyboard can declare; loading and focusing alone never declare", async ({
  page,
  request,
}) => {
  const sessionId = await load(page);
  const choice = page.getByRole("button", { name: "AI assistant", exact: true });
  await choice.focus();
  expect(await events(request, sessionId)).toHaveLength(0);
  await choice.press("Enter");
  await expect(page.getByText("Response recorded: AI assistant.", { exact: true })).toBeVisible();
  expect(await events(request, sessionId)).toHaveLength(1);
});

test("required gate stays locked until the backend acknowledgement arrives", async ({
  page,
  request,
}) => {
  const sessionId = await load(page);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${api}/v1/declarations`, async (route) => {
    await hold;
    await route.continue();
  });
  await page.getByRole("button", { name: "Person", exact: true }).click();
  expect(await isGated(page)).toBe(true);
  expect(await events(request, sessionId)).toHaveLength(0);
  release();
  await expect(page.getByText("Response recorded: Person.", { exact: true })).toBeVisible();
  expect(await isGated(page)).toBe(false);
});

test("reload verifies and restores a recorded session; reset revokes it", async ({
  page,
  request,
}) => {
  const sessionId = await load(page);
  await page.getByRole("button", { name: "Person", exact: true }).click();
  await expect(page.getByText("Response recorded: Person.", { exact: true })).toBeVisible();
  const restored = page.waitForResponse(
    (response) =>
      response.url() === `${api}/v1/sessions/current` && response.request().method() === "GET",
  );
  await page.reload();
  expect((await restored).status()).toBe(200);
  await expect(page.getByText("Response recorded: Person.", { exact: true })).toBeVisible();
  expect(await isGated(page)).toBe(false);
  const revoked = page.waitForResponse(
    (response) =>
      response.url() === `${api}/v1/sessions/current` && response.request().method() === "DELETE",
  );
  const created = page.waitForResponse(
    (response) => response.url() === `${api}/v1/sessions` && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Reset declaration", exact: true }).click();
  expect((await revoked).status()).toBe(204);
  const fresh = (await (await created).json()) as { sessionId: string };
  expect(fresh.sessionId).not.toBe(sessionId);
  await expect(page.getByText("New anonymous session started.", { exact: true })).toBeVisible();
  expect(await isGated(page)).toBe(true);
  expect(await events(request, fresh.sessionId)).toHaveLength(0);
  expect(await events(request, sessionId)).toHaveLength(1);
});

test("separate anonymous tabs and distinct website origins do not inherit declarations", async ({
  page,
  context,
  request,
}) => {
  const sessionId = await load(page);
  await page.getByRole("button", { name: "Person", exact: true }).click();
  await expect(page.getByText("Response recorded: Person.", { exact: true })).toBeVisible();
  const independent = await context.newPage();
  const independentId = await load(independent, "http://127.0.0.1:4311/plain/");
  expect(independentId).not.toBe(sessionId);
  expect(await isGated(independent)).toBe(true);
  const otherOrigin = await context.newPage();
  const otherId = await load(otherOrigin, "http://127.0.0.1:4312/plain/");
  expect(otherId).not.toBe(sessionId);
  expect(otherId).not.toBe(independentId);
  await otherOrigin.getByRole("button", { name: "AI assistant", exact: true }).click();
  await expect(
    otherOrigin.getByText("Response recorded: AI assistant.", { exact: true }),
  ).toBeVisible();
  expect(await events(request, otherId)).toEqual([
    expect.objectContaining({ origin: "http://127.0.0.1:4312", choice: "ai_assistant" }),
  ]);
  expect(await events(request, independentId)).toHaveLength(0);
});

test("blocked sessionStorage falls back to memory without blocking a valid choice", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
    });
  });
  const sessionId = await load(page);
  await page.getByRole("button", { name: "Prefer not to say", exact: true }).click();
  await expect(
    page.getByText("Response recorded: Prefer not to say.", { exact: true }),
  ).toBeVisible();
  expect(await events(request, sessionId)).toHaveLength(1);
  const replacement = page.waitForResponse(
    (response) => response.url() === `${api}/v1/sessions` && response.status() === 201,
  );
  await page.reload();
  expect(((await (await replacement).json()) as { sessionId: string }).sessionId).not.toBe(
    sessionId,
  );
  await expect.poll(() => isGated(page)).toBe(true);
});

test("a failed declaration stays locked and retry records one response", async ({
  page,
  request,
}) => {
  const sessionId = await load(page);
  let fail = true;
  await page.route(`${api}/v1/declarations`, async (route) => {
    if (fail) await route.abort("failed");
    else await route.continue();
  });
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  expect(await isGated(page)).toBe(true);
  expect(await events(request, sessionId)).toHaveLength(0);
  fail = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Response recorded: AI assistant.", { exact: true })).toBeVisible();
  expect(await events(request, sessionId)).toHaveLength(1);
});

test("a lost acknowledgement retries idempotently after the backend already stored it", async ({
  page,
  request,
}) => {
  const sessionId = await load(page);
  let loseFirstResponse = true;
  await page.route(`${api}/v1/declarations`, async (route) => {
    if (loseFirstResponse) {
      loseFirstResponse = false;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  expect(await isGated(page)).toBe(true);
  expect(await events(request, sessionId)).toHaveLength(1);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Response recorded: AI assistant.", { exact: true })).toBeVisible();
  expect(await events(request, sessionId)).toHaveLength(1);
});

test("malformed successful HTTP responses cannot unlock the host form", async ({
  page,
  request,
}) => {
  const sessionId = await load(page);
  await page.route(`${api}/v1/declarations`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "http://127.0.0.1:4311" },
      body: JSON.stringify({ choice: "ai_assistant", receipt: "not-a-valid-record" }),
    });
  });
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  expect(await isGated(page)).toBe(true);
  expect(await events(request, sessionId)).toHaveLength(0);
});

test("a session-creation outage is visible and recoverable without unlocking", async ({ page }) => {
  let fail = true;
  await page.route(`${api}/v1/sessions`, async (route) => {
    if (fail) await route.abort("failed");
    else await route.continue();
  });
  await page.goto("/plain/");
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  expect(await isGated(page)).toBe(true);
  fail = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("button", { name: "Person", exact: true })).toBeEnabled();
  expect(await isGated(page)).toBe(true);
  await page.getByRole("button", { name: "Person", exact: true }).click();
  await expect(page.getByText("Response recorded: Person.", { exact: true })).toBeVisible();
  expect(await isGated(page)).toBe(false);
});

test("reset failure cannot report a new session or discard the stored declaration", async ({
  page,
  request,
}) => {
  const sessionId = await load(page);
  await page.getByRole("button", { name: "Person", exact: true }).click();
  await expect(page.getByText("Response recorded: Person.", { exact: true })).toBeVisible();
  await page.route(`${api}/v1/sessions/current`, async (route) => {
    if (route.request().method() === "DELETE") await route.abort("failed");
    else await route.continue();
  });
  await page.getByRole("button", { name: "Reset declaration", exact: true }).click();
  await expect(
    page.getByText("Reset failed. Your previous session was not cleared.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("New anonymous session started.", { exact: true })).toHaveCount(0);
  await page.unroute(`${api}/v1/sessions/current`);
  await page.reload();
  await expect(page.getByText("Response recorded: Person.", { exact: true })).toBeVisible();
  expect(await events(request, sessionId)).toHaveLength(1);
});

test("repeated initialization and destroy do not duplicate widgets or declarations", async ({
  page,
  request,
}) => {
  const sessionId = await load(page);
  await page.getByRole("button", { name: "Mount widget", exact: true }).click();
  await page.getByRole("button", { name: "Mount widget", exact: true }).click();
  await expect(page.getByRole("button", { name: "Person", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Person", exact: true }).click();
  await expect(page.getByText("Response recorded: Person.", { exact: true })).toBeVisible();
  expect(await events(request, sessionId)).toHaveLength(1);
  await page.getByRole("button", { name: "Remove widget", exact: true }).click();
  await expect(page.getByText("Response recorded: Person.", { exact: true })).toHaveCount(0);
  expect(await isGated(page)).toBe(false);
  await page.getByRole("button", { name: "Mount widget", exact: true }).click();
  await expect(page.getByText("Response recorded: Person.", { exact: true })).toBeVisible();
  expect(await events(request, sessionId)).toHaveLength(1);
});

test("React package works under Strict Mode and cleans up on unmount", async ({ page }) => {
  await load(page, "/react/");
  await expect.poll(() => isGated(page)).toBe(true);
  await expect(page.getByRole("button", { name: "AI assistant", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  await expect(page.getByText("Response recorded: AI assistant.", { exact: true })).toBeVisible();
  await expect(page.getByText("Application received: ai_assistant", { exact: true })).toBeVisible();
  expect(await isGated(page)).toBe(false);
  await page.getByRole("button", { name: "Remove widget", exact: true }).click();
  await expect(page.getByText("Response recorded: AI assistant.", { exact: true })).toHaveCount(0);
  expect(await isGated(page)).toBe(false);
  await page.getByRole("button", { name: "Mount widget", exact: true }).click();
  await expect(page.getByText("Response recorded: AI assistant.", { exact: true })).toBeVisible();
});
