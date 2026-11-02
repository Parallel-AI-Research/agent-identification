import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { createServer } from "node:http";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

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

  const snippet = (await page.locator("pre code").first().textContent()) ?? "";
  const siteId = /data-site="(site_[A-Za-z0-9_-]+)"/.exec(snippet)?.[1];
  expect(siteId).toBeTruthy();
  expect(snippet).not.toContain("YOUR-SITE-ID");

  // Copying the snippet is not an install, so the product keeps waiting.
  const status = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Status" }),
  });
  await expect(status).toContainText("Waiting for installation");
  await page.getByRole("button", { name: "Copy", exact: true }).first().click();
  await page.reload();
  await expect(status).toContainText("Waiting for installation");
  await expect(status).not.toContainText("Receiving events");

  await page.getByText("Set this up with your coding agent").click();
  const instructions = page.locator("details pre code");
  await expect(instructions).toContainText(siteId!);
  await expect(instructions).toContainText("Response recorded");
  await expect(instructions).not.toContainText(secret);

  // The generated snippet works from a real server on the customer's own origin, and is
  // refused on an origin the product doesn't list.
  const serve = (port: number) => {
    const website = createServer((_, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html><title>Site</title>${snippet}`);
    });
    return new Promise<typeof website>((resolve) =>
      website.listen(port, "127.0.0.1", () => resolve(website)),
    );
  };
  const websites = [await serve(4555), await serve(4556)];
  try {
    await page.goto(`${SITE}/`);
    await page.getByRole("button", { name: "AI assistant" }).click();
    await expect(page.getByRole("status")).toHaveText("Response recorded: AI assistant.");
    const refused = page.waitForRequest(
      (request) => request.url().endsWith("/v1/sessions") && request.method() === "POST",
    );
    await page.goto(`${UNLISTED}/`);
    await refused;
  } finally {
    await Promise.all(websites.map((website) => new Promise((resolve) => website.close(resolve))));
  }

  // An agent that signs its request with Web Bot Auth, reported by the customer's server. The
  // key is fixed, so runs in each browser publish the same key to the collector's cache.
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
    const report = await page.request.post(`${COLLECTOR}/v1/signatures`, {
      headers: { authorization: `Bearer ${secret}` },
      data: {
        siteId,
        request: {
          method: "GET",
          url: `${SITE}/pricing`,
          headers: {
            "signature-agent": `sig1="${SIGNER}"`,
            "signature-input": `sig1=${params}`,
            signature: `sig1=:${signature}:`,
          },
        },
      },
    });
    expect(report.ok()).toBe(true);
  } finally {
    await new Promise((resolve) => directory.close(resolve));
  }

  await page.goto("/dashboard");
  await expect(page.getByText("Receiving events")).toBeVisible();
  await page.getByRole("link", { name: /Storefront/ }).click();
  await expect(status).toContainText(`Loaded on ${SITE}`);
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
  await expect(overview).toContainText("1 signed requests it couldn't link to a session");
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
  const production = await page.locator("pre code").first().textContent();
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
  const staging = await page.locator("pre code").first().textContent();
  expect(staging).not.toBe(production);
  expect(staging).toMatch(/data-site="site_/);

  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(page).toHaveURL(/\/activity\?env=[0-9a-f-]{36}$/);
  await expect(page.getByText("No sessions in Staging in the last 7 days.")).toBeVisible();
  await expect(page.getByText(/Nothing has loaded the widget in Staging yet/)).toBeVisible();
  await page.getByRole("link", { name: "Last 30 days" }).click();
  await expect(page).toHaveURL(/range=30d/);
  await expect(page.getByText("No sessions in Staging in the last 30 days.")).toBeVisible();
  await page.getByLabel("Session ID").fill("not a session");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Enter a session ID");
});

test("deleting a product needs its name and removes it", async ({ page }, info) => {
  const email = address(info, "delete");
  await signUp(page, email);
  await confirm(page, email);
  await addProduct(page, "Short-lived", ["https://short-lived.example"]);
  await page.getByRole("link", { name: "Continue to install" }).click();
  const confirmation = page.getByLabel("Type Short-lived to confirm");
  await confirmation.fill("Short lived");
  await page.getByRole("button", { name: "Delete product" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Type Short-lived exactly");
  await confirmation.fill("Short-lived");
  await page.getByRole("button", { name: "Delete product" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("No products yet")).toBeVisible();
});
