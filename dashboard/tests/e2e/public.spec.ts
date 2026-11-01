import { expect, test, type Page } from "@playwright/test";

/** Tabs sit on the left, with the toggle and then Dashboard on the far right. */
async function expectNavbarOrder(page: Page): Promise<void> {
  const navbar = page.locator("header").first();
  const title = await navbar.getByRole("link", { name: "Agent analytics" }).boundingBox();
  const docs = await navbar.getByRole("link", { name: "Docs", exact: true }).boundingBox();
  const changelog = await navbar.getByRole("link", { name: "Changelog" }).boundingBox();
  const search = await navbar
    .getByRole("button", { name: /search/i })
    .first()
    .boundingBox();
  const toggle = await navbar.getByRole("button", { name: "Toggle Theme" }).boundingBox();
  const dashboard = await navbar.getByRole("link", { name: "Dashboard" }).boundingBox();
  const order = [title, docs, changelog, search, toggle, dashboard].map((box) => box!.x);
  expect(order).toEqual([...order].sort((a, b) => a - b));
}

const DOCS = [
  ["/docs", "Introduction"],
  ["/docs/quickstart", "Quickstart"],
  ["/docs/install", "Install"],
  ["/docs/coding-agents", "Set up with a coding agent"],
  ["/docs/server-verification", "Server verification"],
  ["/docs/limits", "What it can't do"],
];

test("the home page works without signing in and states its limits", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("AI agents");
  await expect(page.getByText("A declaration is self-reported.")).toBeVisible();
  await expect(page.getByText("Still being built")).toBeVisible();
  await page.getByRole("link", { name: "Read the quickstart" }).click();
  await expect(page).toHaveURL(/\/docs\/quickstart$/);
});

test("every docs page loads without signing in, with navigation", async ({ page }) => {
  for (const [route, title] of DOCS) {
    await page.goto(route!);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title!);
    const navbar = page.locator("header").first();
    await expect(navbar.getByRole("link", { name: "Changelog" })).toBeVisible();
    await expect(navbar.getByRole("link", { name: "Dashboard" })).toBeVisible();
  }
  await expectNavbarOrder(page);
  await page.goto("/");
  await expectNavbarOrder(page);
  await page.goto("/docs");
  await page.getByRole("link", { name: "Quickstart" }).first().click();
  await expect(page).toHaveURL(/\/docs\/quickstart$/);
  await expect(page.getByRole("link", { name: "Check it works" }).first()).toBeVisible();
});

test("the light and dark toggle applies across the site and is remembered", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/docs/quickstart");
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: "Toggle Theme" }).first().click();
  await expect(html).toHaveClass(/dark/);

  await page.goto("/");
  await expect(html).toHaveClass(/dark/);
  await page.goto("/sign-in");
  await expect(html).toHaveClass(/dark/);
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe("rgb(15, 17, 23)");
});

test("phones can reach the dashboard from the home page and the docs", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });

  await page.goto("/");
  await page.getByRole("button", { name: "Toggle Menu" }).click();
  await expect(page.getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();

  await page.goto("/docs/quickstart");
  await page.getByRole("button", { name: "Open Sidebar" }).click();
  await page
    .locator("#nd-sidebar-mobile")
    .getByRole("link", { name: "Dashboard", exact: true })
    .click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("docs search finds pages", async ({ page }) => {
  const response = await page.request.get("/api/search", { params: { query: "rotate secret" } });
  expect(response.ok()).toBe(true);
  const results = (await response.json()) as { url: string }[];
  expect(results.some((result) => result.url.includes("/docs/server-verification"))).toBe(true);
});

test("the changelog lists updates, newest first, and opens them", async ({ page }) => {
  await page.goto("/changelog");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Changelog");
  await page.getByRole("link", { name: /Accounts, products and environments/ }).click();
  await expect(page).toHaveURL(/\/changelog\/self-service-accounts$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Accounts, products and environments",
  );
});

test("coding agents can read the docs as plain text", async ({ page }) => {
  const index = await page.request.get("/llms.txt");
  expect(index.ok()).toBe(true);
  expect(await index.text()).toContain("/docs/quickstart");

  const full = await (await page.request.get("/llms-full.txt")).text();
  expect(full).toContain("self-reported");
  expect(full).toContain("Server verification");

  const markdown = await page.request.get("/docs/quickstart.md");
  expect(markdown.headers()["content-type"]).toContain("text/markdown");
  expect(await markdown.text()).toContain("YOUR-SITE-ID");
});

test("public pages can be cached, and only the dashboard needs a sign-in", async ({ page }) => {
  for (const route of ["/", "/docs", "/changelog"]) {
    const response = await page.request.get(route);
    expect(response.headers()["cache-control"] ?? "", route).not.toContain("private");
  }
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/dashboard/products/new");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("old product links reach the dashboard", async ({ page }) => {
  for (const [from, to] of [
    ["/products", "/dashboard"],
    ["/products/new", "/dashboard/products/new"],
    [
      "/products/11111111-1111-4111-8111-111111111111",
      "/dashboard/products/11111111-1111-4111-8111-111111111111",
    ],
  ]) {
    const response = await page.request.get(from!, { maxRedirects: 0 });
    expect(response.status(), from).toBe(308);
    expect(response.headers().location, from).toBe(to);
  }
});
