import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { test as withNext } from "next/experimental/testmode/playwright";

const MAIL = "http://127.0.0.1:54324";
const PASSWORD = "correct-horse-battery";
const SITE = "http://127.0.0.1:4555";
const UNLISTED = "http://127.0.0.1:4556";
const COLLECTOR = "http://127.0.0.1:4310";
// The local collector trusts this signer only in its memory demo.
const SIGNER = "http://127.0.0.1:4557";

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
  await expect(page).toHaveURL(/\/dashboard$/);
}
async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}
async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
}
async function addProduct(page: Page, name: string, origins: string[]): Promise<string> {
  await page.goto("/dashboard/products/new");
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
  const navbar = page.locator("header").first();
  await expect(navbar.getByRole("link", { name: "Docs" })).toBeVisible();
  const tab = await navbar.getByRole("link", { name: "Dashboard" }).boundingBox();
  const avatar = await navbar.getByRole("button", { name: "Account menu" }).boundingBox();
  expect(tab!.x).toBeLessThan(avatar!.x);
  await navbar.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByText(email)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(navbar.getByRole("button", { name: "Toggle Theme" })).toBeVisible();

  await page.goto("/dashboard/products/new");
  await page.getByLabel("Product name").fill("Wildcard");
  await page.getByLabel("Website origins").fill("https://*.example.com");
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("must be exact");

  const secret = await addProduct(page, "Storefront", [SITE, "https://www.onboarding.example"]);
  expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await page.getByRole("link", { name: "Continue to install" }).click();
  await expect(page).toHaveURL(/\/dashboard\/products\/[0-9a-f-]{36}$/);
  expect(page.url()).not.toContain(secret);
  await expect(page.locator("body")).not.toContainText(secret);

  // The default install is server reporting, which adds nothing to the customer's pages.
  const install = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Install" }),
  });
  await expect(install.getByRole("tab", { name: "Next.js" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const snippet = (await install.locator("pre code").first().textContent()) ?? "";
  const siteId = /siteId: "(site_[A-Za-z0-9_-]+)"/.exec(snippet)?.[1];
  expect(siteId).toBeTruthy();
  expect(snippet).toContain("reportSignedRequest");
  expect(snippet).toContain("reportRequestSignals");
  expect(snippet).not.toContain("YOUR-SITE-ID");
  expect(snippet).not.toContain("<script");

  // Copying the snippet is not an install, so the product keeps waiting.
  const status = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Status" }),
  });
  await expect(status).toContainText("Waiting for installation");
  await expect(status).toContainText(`curl -A "HeadlessChrome/1.0 (install check)" ${SITE}/`);
  await install.getByRole("button", { name: "Copy", exact: true }).first().click();
  await page.reload();
  await expect(status).toContainText("Waiting for installation");
  await expect(status).not.toContainText("Receiving events");

  await page.getByText("Set this up with your coding agent").click();
  const instructions = page.locator("details", { hasText: "coding agent" }).locator("pre code");
  await expect(instructions).toContainText(siteId!);
  await expect(instructions).toContainText("don't add the declaration widget");
  await expect(instructions).not.toContainText("visitor-choice");
  await expect(instructions).not.toContainText(secret);

  // The customer's own server on its own origin, running the server package the way the
  // snippet does. It waits for the reports here only so the test doesn't race them.
  const sdk = (await import(
    pathToFileURL(path.resolve(process.cwd(), "../dist/server/index.js")).href
  )) as typeof import("../../../src/server/index");
  const agentId = { apiUrl: COLLECTOR, siteId: siteId!, secret };
  let pageHtml = "<!doctype html><title>Site</title>";
  const serve = (port: number, report: boolean) => {
    const website = createServer(async (request, response) => {
      if (report) {
        await Promise.all([
          sdk.reportSignedRequest(request, agentId),
          sdk.reportRequestSignals(request, agentId),
        ]);
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end(pageHtml);
    });
    return new Promise<typeof website>((resolve) =>
      website.listen(port, "127.0.0.1", () => resolve(website)),
    );
  };
  const websites = [await serve(4555, true), await serve(4556, false)];
  try {
    // The install check from the Status card: one request that claims a headless browser.
    const check = await page.request.get(`${SITE}/`, {
      headers: { "user-agent": "HeadlessChrome/1.0 (install check)" },
    });
    expect(check.ok()).toBe(true);
    await page.reload();
    await expect(status).toContainText("Receiving events");
    await expect(status).toContainText("Your server last reported just now");
    await expect(status).not.toContainText("The widget loaded");

    // An agent that signs its request with Web Bot Auth asks the customer's site for a page,
    // and the site's server reports it. The key is fixed, so runs in each browser publish the
    // same key to the collector's cache.
    const privateKey = createPrivateKey({
      key: Buffer.from(`302e020100300506032b657004220420${"11".repeat(32)}`, "hex"),
      format: "der",
      type: "pkcs8",
    });
    const jwk = createPublicKey(privateKey).export({ format: "jwk" });
    const keyid = createHash("sha256")
      .update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x }))
      .digest("base64url");
    const directory = createServer((_, response) => {
      response.writeHead(200, {
        "content-type": "application/http-message-signatures-directory+json",
      });
      response.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => directory.listen(4557, "127.0.0.1", resolve));
    try {
      const created = Math.floor(Date.now() / 1000);
      const params = `("@authority" "signature-agent";key="sig1");created=${created};keyid="${keyid}";alg="ed25519";expires=${created + 300};tag="web-bot-auth"`;
      const base = `"@authority": ${new URL(SITE).host}\n"signature-agent";key="sig1": "${SIGNER}"\n"@signature-params": ${params}`;
      const signature = sign(null, Buffer.from(base), privateKey).toString("base64");
      const visit = await page.request.get(`${SITE}/pricing`, {
        headers: {
          "signature-agent": `sig1="${SIGNER}"`,
          "signature-input": `sig1=${params}`,
          signature: `sig1=:${signature}:`,
        },
      });
      expect(visit.ok()).toBe(true);
    } finally {
      await new Promise((resolve) => directory.close(resolve));
    }

    // The declaration widget stays available as an opt-in that says everyone sees it. It
    // works on the customer's own origin and is refused on one the product doesn't list.
    await page.getByText("Optional: the declaration widget").click();
    const widget = page.locator("details", { hasText: "Optional: the declaration widget" });
    await expect(widget).toContainText("Every visitor sees this widget, people included");
    const widgetSnippet = (await widget.locator("pre code").textContent()) ?? "";
    expect(widgetSnippet).toContain(`data-site="${siteId}"`);
    pageHtml += widgetSnippet;
    await page.goto(`${SITE}/`);
    await page.getByRole("button", { name: "AI assistant" }).click();
    await expect(page.getByRole("status")).toHaveText("Response recorded: AI assistant.");
    const refused = page.waitForRequest(
      (request) => request.url().endsWith("/v1/sessions") && request.method() === "POST",
    );
    await page.goto(`${UNLISTED}/`);
    await refused;
  } finally {
    // Closing waits for idle keep-alive connections, which WebKit holds open for a while.
    for (const website of websites) website.closeAllConnections();
    await Promise.all(websites.map((website) => new Promise((resolve) => website.close(resolve))));
  }

  await page.goto("/dashboard");
  await expect(page.getByText("Receiving events")).toBeVisible();
  await page.getByRole("link", { name: /Storefront/ }).click();
  await expect(status).toContainText("Your server last reported just now");
  await expect(status).toContainText(`The widget loaded on ${SITE}`);
  await expect(status).toContainText("Last declaration just now");
  await expect(async () => {
    await page.reload();
    await expect(status).toContainText(`A page on ${UNLISTED} tried to load the widget`, {
      timeout: 1000,
    });
  }).toPass({ timeout: 10_000 });

  const signed = page.locator("section", { hasText: "Signed agents" });
  await expect(signed).toContainText("Local test signer on /pricing");
  await expect(signed.getByText("Verified", { exact: true })).toBeVisible();

  // Activity counts each kind of thing once and labels the session by its strongest signal.
  const productUrl = page.url();
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(page).toHaveURL(/\/activity\?env=[0-9a-f-]{36}$/);
  const overview = page.locator("section", { hasText: "Overview" });
  await expect(overview).toContainText("Sessions1");
  await expect(overview).toContainText("Page views1");
  await expect(overview).toContainText("Signed requests1");
  // The server's reports carry no session binding, so they stand apart from the widget's session.
  await expect(overview).toContainText(
    "0 actions, 1 signed requests and 1 automation signals it couldn't link to a session",
  );
  await page.getByRole("link", { name: /Declared AI/ }).click();
  const timeline = page.locator("section", { hasText: "Timeline" });
  await expect(timeline).toContainText("Answered AI assistant");
  await expect(timeline).toContainText("Said by the visitor");
  await expect(timeline).toContainText("Viewed /");
  await expect(timeline).toContainText("Reported by your page");
  await page.goto(productUrl);

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

  // The Dashboard tab leads from a product back to the product list, on a phone too.
  await navbar.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: /Storefront/ }).click();
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 760 });
  await navbar.getByRole("button", { name: "Toggle Menu" }).click();
  await navbar.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(navbar.getByRole("link", { name: "Dashboard" })).toBeHidden();
  await page.setViewportSize(size);

  await signOut(page);
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("a second customer cannot reach the first customer's product", async ({ page }, info) => {
  const first = address(info, "first");
  await signUp(page, first);
  await confirm(page, first);
  await addProduct(page, "Private product", ["https://first.example"]);
  await page.getByRole("link", { name: "Continue to install" }).click();
  await expect(page).toHaveURL(/\/dashboard\/products\/[0-9a-f-]{36}$/);
  const url = page.url();
  await signOut(page);
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
  await expect(other).toHaveURL(/\/dashboard$/);
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

test("copying a secret always says what happened", async ({ page }, info) => {
  const email = address(info, "copy");
  await signUp(page, email);
  await confirm(page, email);
  const secret = await addProduct(page, "Clipboard", ["https://clipboard.example"]);
  const button = page.getByRole("button", { name: "Copy secret" });

  // The clipboard is denied, as in embedded browsers, but the older command still works.
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      value: () => Promise.reject(new DOMException("Denied", "NotAllowedError")),
    });
    document.execCommand = () => true;
  });
  await button.click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();

  // With both blocked, the person is told, and the secret is ready to copy by hand.
  await page.evaluate(() => {
    document.execCommand = () => false;
  });
  await button.click();
  await expect(page.getByText("This browser blocked copying")).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(secret);
});

test("password reset works and doesn't reveal who has an account", async ({ page }, info) => {
  const email = address(info, "reset");
  await signUp(page, email);
  await confirm(page, email);
  await signOut(page);
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
  await expect(page).toHaveURL(/\/dashboard$/);
  await signOut(page);
  await expect(page).toHaveURL(/\/sign-in$/);

  await signIn(page, email);
  await expect(page.locator("p[role=alert]")).toContainText("incorrect");
  await signIn(page, email, replacement);
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("an environment is added from the dashboard, with its own snippet and analytics", async ({
  page,
}, info) => {
  const email = address(info, "environments");
  await signUp(page, email);
  await confirm(page, email);
  await addProduct(page, "Environments", ["https://env.example"]);
  await page.getByRole("link", { name: "Continue to install" }).click();
  const snippet = () =>
    page
      .locator("section", { has: page.getByRole("heading", { name: "Install" }) })
      .locator("pre code")
      .first()
      .textContent();
  const production = await snippet();
  await expect(page.getByRole("link", { name: "Production", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.getByRole("combobox", { name: "Environment" }).selectOption("staging");
  await page.getByLabel("Its website origins").fill("https://staging.env.example");
  await page.getByRole("button", { name: "Add environment" }).click();
  await expect(page.getByText("Staging is ready")).toBeVisible();
  await expect(page.getByText("It is shown once")).toBeVisible();
  await page.getByRole("link", { name: "Open Staging to copy its snippet" }).click();
  await expect(page).toHaveURL(/\?env=[0-9a-f-]{36}$/);
  await expect(page.getByRole("link", { name: "Staging", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const staging = await snippet();
  expect(staging).not.toBe(production);
  expect(staging).toMatch(/siteId: "site_/);

  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(page).toHaveURL(/\/activity\?env=[0-9a-f-]{36}$/);
  await expect(page.getByText("No sessions in Staging in the last 7 days.")).toBeVisible();
  await expect(page.getByText(/Nothing has reported to Staging yet/)).toBeVisible();
  await page.getByRole("link", { name: "Last 30 days" }).click();
  await expect(page).toHaveURL(/range=30d/);
  await expect(page.getByText("No sessions in Staging in the last 30 days.")).toBeVisible();
  await page.getByLabel("Session ID").fill("not a session");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Enter a session ID");
});

// Next's test mode fakes the dashboard server's calls to the collector, for this test's requests only.
withNext(
  "activity offers a retry when the collector stops answering",
  async ({ page, next }, info) => {
    let answering = true;
    next.onFetch((request) => {
      if (
        !answering &&
        /\/v1\/owner\/products\/.+\/analytics$/.test(new URL(request.url).pathname)
      ) {
        return "abort";
      }
      // Every other call really happens. The test sends it, because Next's "continue" can't
      // resend a request body it has already read.
      return fetch(request);
    });
    const email = address(info, "outage");
    await signUp(page, email);
    await confirm(page, email);
    await addProduct(page, "Outage", ["https://outage.example"]);
    await page.getByRole("link", { name: "Continue to install" }).click();
    await page.getByRole("link", { name: "Activity", exact: true }).click();
    await expect(page.getByText("No sessions in Production in the last 7 days.")).toBeVisible();

    // The product loads, then the analytics request fails, so no counts are shown at all.
    answering = false;
    await page.getByRole("link", { name: "Last 30 days" }).click();
    await expect(
      page.getByText(/Activity couldn't load because the collector didn't answer/),
    ).toBeVisible();
    await expect(page.getByText(/No sessions in Production/)).toBeHidden();

    answering = true;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("No sessions in Production in the last 30 days.")).toBeVisible();
    await expect(page.getByText(/Activity couldn't load/)).toBeHidden();
  },
);

test("a deleted product can be restored, or removed for good", async ({ page }, info) => {
  const email = address(info, "delete");
  await signUp(page, email);
  await confirm(page, email);
  await addProduct(page, "Short-lived", ["https://short-lived.example"]);
  await page.getByRole("link", { name: "Continue to install" }).click();
  const remove = async () => {
    await page.getByLabel("Type Short-lived to confirm").fill("Short-lived");
    await page.getByRole("button", { name: "Delete product" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  };
  await page.getByLabel("Type Short-lived to confirm").fill("Short lived");
  await page.getByRole("button", { name: "Delete product" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Type Short-lived exactly");
  await remove();
  await expect(page.getByText("No products yet")).toBeVisible();
  const deleted = page.getByRole("region", { name: "Recently deleted" });
  await expect(deleted).toContainText("Short-lived");
  await expect(deleted).toContainText("Restorable until");

  await deleted.getByRole("button", { name: "Restore" }).click();
  await expect(deleted).toBeHidden();
  await page.getByRole("link", { name: /Short-lived/ }).click();
  await remove();
  await deleted.getByRole("button", { name: "Delete now" }).click();
  await expect(deleted).toContainText("It can't be undone");
  await deleted.getByRole("button", { name: "Delete for good" }).click();
  await expect(deleted).toBeHidden();
  await expect(page.getByText("No products yet")).toBeVisible();
});
