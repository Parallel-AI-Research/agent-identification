import { createServer } from "node:http";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const MAIL = "http://127.0.0.1:54324";
const PASSWORD = "correct-horse-battery";
const SITE = "http://127.0.0.1:4555";

function address(info: TestInfo, name: string): string {
  return `${name}-${info.project.name}-${Date.now()}@example.com`;
}

async function emailLink(page: Page, to: string, pattern: RegExp): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = await page.request.get(`${MAIL}/api/v1/search`, {
      params: { query: `to:"${to}"` },
    });
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    for (const { ID } of messages ?? []) {
      const message = await page.request.get(`${MAIL}/api/v1/message/${ID}`);
      const { Text, HTML } = (await message.json()) as { Text: string; HTML: string };
      const body = `${Text} ${HTML}`.replaceAll("&amp;", "&");
      const link = pattern.exec(body)?.[0];
      if (link) return link;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`No email for ${to}`);
}

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
}
async function confirm(page: Page, email: string): Promise<void> {
  await page.goto(await emailLink(page, email, /http[^\s"<>]+type=signup[^\s"<>]*/));
  await expect(page).toHaveURL(/\/products$/);
}
async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}
async function addProduct(page: Page, name: string, origins: string[]): Promise<string> {
  await page.goto("/products/new");
  await page.getByLabel("Product name").fill(name);
  await page.getByLabel("Website origins").fill(origins.join("\n"));
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page.getByText("It is shown once")).toBeVisible();
  return (await page.locator("pre code").first().textContent()) ?? "";
}

test("a new customer goes from sign-up to a working install", async ({ page }, info) => {
  const email = address(info, "owner");
  await signUp(page, email);

  await signIn(page, email);
  await expect(page.locator("p[role=alert]")).toContainText("Confirm your email first");

  await confirm(page, email);
  await expect(page.getByText("No products yet")).toBeVisible();

  await page.goto("/products/new");
  await page.getByLabel("Product name").fill("Wildcard");
  await page.getByLabel("Website origins").fill("https://*.example.com");
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("must be exact");

  const secret = await addProduct(page, "Storefront", [SITE, "https://www.onboarding.example"]);
  expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await page.getByRole("link", { name: "Continue to install" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  expect(page.url()).not.toContain(secret);
  await expect(page.locator("body")).not.toContainText(secret);

  const snippet = (await page.locator("pre code").first().textContent()) ?? "";
  const siteId = /data-site="(site_[A-Za-z0-9_-]+)"/.exec(snippet)?.[1];
  expect(siteId).toBeTruthy();
  expect(snippet).not.toContain("YOUR-SITE-ID");

  // The generated snippet works from a real server on the customer's own origin.
  const website = createServer((_, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><title>Site</title>${snippet}`);
  });
  await new Promise<void>((resolve) => website.listen(4555, "127.0.0.1", resolve));
  try {
    await page.goto(`${SITE}/`);
    await page.getByRole("button", { name: "AI assistant" }).click();
    await expect(page.getByRole("status")).toHaveText("Response recorded: AI assistant.");
  } finally {
    await new Promise((resolve) => website.close(resolve));
  }

  await page.goto("/products");
  await page.getByRole("link", { name: /Storefront/ }).click();

  await expect(page.getByText("Unverified", { exact: true })).toBeVisible();
  await expect(page.getByText("_agent-identification.www.onboarding.example")).toBeVisible();
  await page.getByRole("button", { name: "Check DNS record" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("No matching TXT record");

  await page.getByRole("button", { name: "Rotate secret" }).click();
  await page.getByRole("button", { name: "Rotate now" }).click();
  await expect(page.getByText("It is shown once")).toBeVisible();
  const rotated =
    (await page.locator("section", { hasText: "Server-only" }).locator("pre code").textContent()) ??
    "";
  expect(rotated).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(rotated).not.toBe(secret);
  await page.reload();
  await expect(page.locator("body")).not.toContainText(rotated);
  await page.getByRole("button", { name: "Revoke old secret now" }).click();
  await expect(page.getByText("The old secret has been revoked")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/products");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("a second customer cannot reach the first customer's product", async ({ page }, info) => {
  const first = address(info, "first");
  await signUp(page, first);
  await confirm(page, first);
  await addProduct(page, "Private product", ["https://first.example"]);
  await page.getByRole("link", { name: "Continue to install" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  const url = page.url();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  const second = address(info, "second");
  await signUp(page, second);
  await confirm(page, second);
  await expect(page.getByText("No products yet")).toBeVisible();
  await page.goto(url);
  await expect(page.getByText("Page not found")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Private product");
});

test("an email link opened in another browser explains what happened", async ({
  browser,
  page,
}, info) => {
  const email = address(info, "elsewhere");
  await signUp(page, email);
  const baseURL = info.project.use.baseURL;
  const elsewhere = await browser.newContext({ baseURL });
  const other = await elsewhere.newPage();

  // The email really is confirmed, so the person is told that and can sign in.
  await other.goto(await emailLink(page, email, /http[^\s"<>]+type=signup[^\s"<>]*/));
  await expect(other).toHaveURL(/\/sign-in\?notice=confirmed$/);
  await expect(other.getByText("Your email is confirmed")).toBeVisible();
  await expect(other.locator("p[role=alert]")).toHaveCount(0);
  await signIn(other, email);
  await expect(other).toHaveURL(/\/products$/);
  await elsewhere.close();

  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("If that email has an account")).toBeVisible();

  // A reset can't continue elsewhere, and the person is told how to finish it.
  const third = await (await browser.newContext({ baseURL })).newPage();
  await third.goto(await emailLink(page, email, /http[^\s"<>]+type=recovery[^\s"<>]*/));
  await expect(third).toHaveURL(/\/forgot-password\?error=browser$/);
  await expect(third.locator("p[role=alert]")).toContainText("browser that requested");
  await third.context().close();
});

test("password reset works and doesn't reveal who has an account", async ({ page }, info) => {
  const email = address(info, "reset");
  await signUp(page, email);
  await confirm(page, email);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(address(info, "nobody"));
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("If that email has an account")).toBeVisible();

  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("If that email has an account")).toBeVisible();

  await page.goto(await emailLink(page, email, /http[^\s"<>]+type=recovery[^\s"<>]*/));
  await expect(page).toHaveURL(/\/reset-password$/);
  const replacement = "a-brand-new-password";
  await page.getByLabel("New password").fill(replacement);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page).toHaveURL(/\/products$/);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  await signIn(page, email);
  await expect(page.locator("p[role=alert]")).toContainText("incorrect");
  await signIn(page, email, replacement);
  await expect(page).toHaveURL(/\/products$/);
});
