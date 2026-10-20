import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createBindingContext, verifyDeclarationOnline } from "../dist/server/index.js";

if (!process.argv[2]) {
  console.error("Usage: node scripts/smoke-hosted.mjs https://collector.example");
  process.exit(2);
}
const target = new URL(process.argv[2]);
if (
  target.protocol !== "https:" ||
  target.username ||
  target.password ||
  target.pathname !== "/" ||
  target.search ||
  target.hash
) {
  throw new Error("Pass a collector HTTPS origin without credentials, a path, query, or fragment.");
}
const baseUrl = target.origin;
const secret = process.env.AGENT_ID_SITE_SECRET;
const trialSecret = process.env.AGENT_ID_TRIAL_SECRET;
const origin = "https://useparallel.com";
const outputDirectory = resolve(".local");
await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
const reportPath = resolve(outputDirectory, "hosted-smoke.json");
const screenshotPath = resolve(outputDirectory, "hosted-smoke.png");
const report = {
  baseUrl,
  startedAt: new Date().toISOString(),
  status: "running",
  checks: [],
  sessions: [],
  cleanup: [],
};
const sessions = new Map();
const pendingCaptures = [];
let browser;
let currentStep = "health";

class SmokeCheckError extends Error {}

function check(condition, description) {
  if (!condition) throw new SmokeCheckError(description);
}
function remember(session) {
  if (!session?.sessionId || !session.sessionToken || !session.siteId || !session.origin) {
    throw new Error("Session response omitted required fields.");
  }
  sessions.set(session.sessionToken, session);
}
async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
}
function sessionHeaders(session) {
  return {
    Origin: session.origin,
    Authorization: `Bearer ${session.sessionToken}`,
    "X-Agent-Site": session.siteId,
  };
}
async function revoke(session) {
  return request("/v1/sessions/current", {
    method: "DELETE",
    headers: sessionHeaders(session),
  });
}
async function createSession(websiteOrigin, bindingContext) {
  const response = await request("/v1/sessions", {
    method: "POST",
    headers: { Origin: websiteOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({
      siteId: "parallel",
      ...(bindingContext ? { bindingContext } : {}),
    }),
  });
  check(response.status === 201, "Session creation failed.");
  check(
    response.headers.get("access-control-allow-origin") === websiteOrigin,
    "Origin acknowledgement mismatch.",
  );
  const session = await response.json();
  remember(session);
  check(
    session.origin === websiteOrigin && session.siteId === "parallel",
    "Session scope mismatch.",
  );
  return session;
}
async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.on("response", (response) => {
    if (
      response.url() === `${baseUrl}/v1/sessions` &&
      response.request().method() === "POST" &&
      response.status() === 201
    ) {
      const capture = response.json().then(remember);
      pendingCaptures.push(capture);
      void capture.catch(() => {});
    }
  });
  return context.newPage();
}
async function declare(page, expectedSite, expectedOrigin) {
  const accepted = page.waitForResponse(
    (response) =>
      response.url() === `${baseUrl}/v1/declarations` && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  const response = await accepted;
  check(response.status() === 200, "Browser declaration was not accepted.");
  const declaration = await response.json();
  check(
    declaration.siteId === expectedSite &&
      declaration.origin === expectedOrigin &&
      declaration.choice === "ai_assistant" &&
      declaration.evidence === "self_reported" &&
      typeof declaration.eventId === "string",
    "Browser declaration scope or choice mismatch.",
  );
  await page.getByText("Response recorded: AI assistant.", { exact: true }).waitFor();
  report.sessions.push({
    sessionId: declaration.sessionId,
    eventId: declaration.eventId,
    siteId: declaration.siteId,
    origin: declaration.origin,
    choice: declaration.choice,
  });
  return declaration;
}
async function gated(page, selector) {
  return page.locator(selector).evaluate((element) => element.inert);
}

try {
  const healthResponse = await request("/health");
  check(healthResponse.ok, "Collector health failed.");
  const health = await healthResponse.json();
  check(
    health.ok === true && health.storage === "postgres",
    "Collector must use healthy Postgres.",
  );
  report.health = { ok: true, storage: health.storage, version: health.version };
  report.checks.push("healthy-postgres");

  const browserEnv = { ...process.env };
  delete browserEnv.AGENT_ID_SITE_SECRET;
  delete browserEnv.AGENT_ID_TRIAL_SECRET;
  browser = await chromium.launch({ env: browserEnv });

  currentStep = "public-demo-record-and-reset";
  const landing = await newPage();
  await landing.goto(baseUrl);
  await landing.getByRole("button", { name: "AI assistant", exact: true }).waitFor();
  check(
    (await landing.locator("#install-code").textContent()).includes("data-site") &&
      (await landing.locator("#package-code").textContent()).includes("npm install"),
    "Landing installation instructions are missing.",
  );
  check(
    (await landing.locator('a[href="/trial/"]').count()) > 0,
    "Landing does not link to the clean trial.",
  );
  check(await gated(landing, "#demo-form"), "Public demo must initially gate its form.");
  await landing.screenshot({ path: screenshotPath, fullPage: true });
  await chmod(screenshotPath, 0o600);
  const publicDeclaration = await declare(landing, "public-demo", baseUrl);
  check(!(await gated(landing, "#demo-form")), "Accepted demo declaration did not unlock.");
  const revoked = landing.waitForResponse(
    (response) =>
      response.url() === `${baseUrl}/v1/sessions/current` &&
      response.request().method() === "DELETE",
  );
  const restarted = landing.waitForResponse(
    (response) =>
      response.url() === `${baseUrl}/v1/sessions` && response.request().method() === "POST",
  );
  await landing.getByRole("button", { name: "Start a new session", exact: true }).click();
  check((await revoked).status() === 204, "Public demo reset did not revoke.");
  const fresh = await (await restarted).json();
  check(
    fresh.sessionId !== publicDeclaration.sessionId && fresh.choice === null,
    "Reset reused declaration.",
  );
  check(await gated(landing, "#demo-form"), "Reset must gate the form again.");
  report.checks.push("public-demo-recorded", "public-demo-reset-revoked");

  currentStep = "clean-required-trial";
  const trial = await newPage();
  await trial.goto(`${baseUrl}/trial/`);
  await trial.getByRole("button", { name: "AI assistant", exact: true }).waitFor();
  check(await gated(trial, "#announcement-form"), "Required trial must gate its form.");
  const trialText = await trial.locator("body").evaluate((body) => {
    const clone = body.cloneNode(true);
    clone.querySelector("#visitor-choice")?.remove();
    clone.querySelectorAll("script, style").forEach((element) => element.remove());
    return clone.textContent ?? "";
  });
  check(
    !/\b(?:install|npm|SDK|research|experiment|trial|collector|optional mode|required mode|new session|reset declaration)\b/i.test(
      trialText,
    ) && (await trial.locator("pre, code").count()) === 0,
    "Trial includes installation or experiment instructions.",
  );
  const trialDeclaration = await declare(trial, "agent-trials", baseUrl);
  check(!(await gated(trial, "#announcement-form")), "Accepted trial choice did not unlock.");
  await trial.locator('[name="headline"]').fill("Hosted trial smoke check");
  await trial.locator('[name="body"]').fill("This announcement remains a local preview.");
  await trial.getByRole("button", { name: "Preview announcement", exact: true }).click();
  await trial.getByRole("heading", { name: "Announcement preview", exact: true }).waitFor();
  check(
    (await trial.locator("#announcement-preview").textContent()).includes(
      "Hosted trial smoke check",
    ),
    "Trial did not preview the entered headline.",
  );
  const reloaded = trial.waitForResponse(
    (response) =>
      response.url() === `${baseUrl}/v1/sessions` &&
      response.request().method() === "POST" &&
      response.status() === 201,
  );
  await trial.reload();
  const reloadedSession = await (await reloaded).json();
  await trial.getByRole("button", { name: "AI assistant", exact: true }).waitFor();
  check(
    reloadedSession.siteId === "agent-trials" &&
      reloadedSession.sessionId !== trialDeclaration.sessionId &&
      reloadedSession.choice === null &&
      (await gated(trial, "#announcement-form")),
    "Trial reload inherited a recorded identification session.",
  );
  report.checks.push("clean-required-trial-recorded-and-previewed", "trial-reload-starts-fresh");

  currentStep = "clean-optional-trial";
  let optionalDeclarations = 0;
  trial.on("request", (incoming) => {
    if (incoming.url() === `${baseUrl}/v1/declarations` && incoming.method() === "POST") {
      optionalDeclarations += 1;
    }
  });
  const optionalCreated = trial.waitForResponse(
    (response) =>
      response.url() === `${baseUrl}/v1/sessions` &&
      response.request().method() === "POST" &&
      response.status() === 201,
  );
  await trial.goto(`${baseUrl}/trial/?mode=optional`);
  const optionalSession = await (await optionalCreated).json();
  await trial.getByRole("button", { name: "Person", exact: true }).waitFor();
  check(!(await gated(trial, "#announcement-form")), "Optional trial blocked its form.");
  await trial.locator('[name="headline"]').fill("No identification was submitted");
  await trial
    .locator('[name="body"]')
    .fill("An unanswered optional choice leaves the task usable.");
  await trial.getByRole("button", { name: "Preview announcement", exact: true }).click();
  await trial.getByRole("heading", { name: "Announcement preview", exact: true }).waitFor();
  check(optionalDeclarations === 0, "Optional trial automatically submitted a declaration.");
  const optionalStatusResponse = await request("/v1/sessions/current", {
    headers: sessionHeaders(optionalSession),
  });
  check(optionalStatusResponse.ok, "Optional trial session could not be checked.");
  const optionalStatus = await optionalStatusResponse.json();
  check(
    optionalStatus.siteId === "agent-trials" && optionalStatus.choice === null,
    "Optional trial unexpectedly recorded identification.",
  );
  report.checks.push("optional-trial-task-without-identification");

  if (trialSecret) {
    currentStep = "private-trial-event-export";
    const exported = await request("/v1/events?siteId=agent-trials&limit=1000", {
      headers: { Authorization: `Bearer ${trialSecret}` },
    });
    check(exported.ok, "Private trial event export failed.");
    const data = await exported.json();
    check(Array.isArray(data.events), "Trial event export is malformed.");
    const event = data.events.find((candidate) => candidate.id === trialDeclaration.eventId);
    check(
      event?.siteId === "agent-trials" &&
        event.origin === baseUrl &&
        event.choice === "ai_assistant" &&
        event.sessionId === trialDeclaration.sessionId,
      "Trial browser declaration is missing from private event export.",
    );
    check(
      !data.events.some((candidate) => candidate.sessionId === optionalSession.sessionId),
      "Optional unanswered trial unexpectedly has a declaration event.",
    );
    report.checks.push("private-trial-export-matches-required-and-optional-evidence");
  } else {
    report.trialSecretChecks = "skipped: AGENT_ID_TRIAL_SECRET was not supplied";
  }

  currentStep = "react-demo";
  const react = await newPage();
  await react.goto(`${baseUrl}/demo-react/`);
  await react.getByRole("button", { name: "AI assistant", exact: true }).waitFor();
  check(await gated(react, "#publish-form"), "React form was not initially gated.");
  await declare(react, "public-demo", baseUrl);
  await react.getByText("Application received: ai_assistant", { exact: true }).waitFor();
  check(!(await gated(react, "#publish-form")), "React form did not unlock.");
  check(
    (await react.getByRole("link", { name: "Open script example" }).getAttribute("href")) === "/",
    "Hosted React example links to the local example path.",
  );
  report.checks.push("react-callback-and-hosted-links");

  currentStep = "parallel-cross-origin-script";
  const parallel = await newPage();
  // All requests to Parallel's website are intercepted. This creates a browser
  // fixture under its allowed origin; it never reads or edits the real website.
  await parallel.context().route("https://useparallel.com/**", async (route) => {
    if (new URL(route.request().url()).pathname !== "/__agent-id-sdk-smoke__") {
      await route.abort();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": `default-src 'none'; script-src ${baseUrl}; style-src ${baseUrl}; connect-src ${baseUrl}; base-uri 'none'; form-action 'none'`,
      },
      body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Isolated SDK smoke fixture</title><script defer src="${baseUrl}/sdk/v0.1.0/agent-id.js" data-site="parallel" data-target="#visitor-choice" data-mode="required" data-gate="#protected-form"></script></head><body><h1>Isolated SDK smoke fixture</h1><div id="visitor-choice"></div><form id="protected-form"><button>Continue</button></form></body></html>`,
    });
  });
  await parallel.goto(`${origin}/__agent-id-sdk-smoke__`);
  await parallel.getByRole("button", { name: "AI assistant", exact: true }).waitFor();
  check(await gated(parallel, "#protected-form"), "Cross-origin fixture did not gate.");
  const parallelDeclaration = await declare(parallel, "parallel", origin);
  check(!(await gated(parallel, "#protected-form")), "Cross-origin fixture did not unlock.");
  const resetStatus = await parallel.evaluate(async (apiUrl) => {
    const widget = window.AgentIdentification.init({
      container: "#visitor-choice",
      gate: "#protected-form",
      siteId: "parallel",
      apiUrl,
      mode: "required",
    });
    const state = await widget.reset();
    return { sessionId: state.sessionId, choice: state.choice };
  }, baseUrl);
  check(
    resetStatus.sessionId !== parallelDeclaration.sessionId && resetStatus.choice === null,
    "Cross-origin reset did not start a new session.",
  );
  report.checks.push("parallel-cross-origin-script-recorded-and-reset");

  currentStep = "www-origin";
  const wwwOrigin = "https://www.useparallel.com";
  const preflight = await request("/v1/sessions", {
    method: "OPTIONS",
    headers: {
      Origin: wwwOrigin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type",
    },
  });
  check(preflight.status === 204, "WWW preflight failed.");
  check(
    preflight.headers.get("access-control-allow-origin") === wwwOrigin,
    "WWW preflight origin mismatch.",
  );
  const wwwSession = await createSession(wwwOrigin);
  check((await revoke(wwwSession)).status === 204, "WWW fixture revocation failed.");
  report.checks.push("www-origin-preflight-create-revoke");

  if (secret) {
    currentStep = "bound-server-verification";
    const options = {
      apiUrl: baseUrl,
      siteId: "parallel",
      origin,
      secret,
      sessionBinding: `hosted-smoke-${randomUUID()}`,
    };
    const bindingContext = createBindingContext(options);
    const bound = await createSession(origin, bindingContext);
    const accepted = await request("/v1/declarations", {
      method: "POST",
      headers: { ...sessionHeaders(bound), "Content-Type": "application/json" },
      body: JSON.stringify({ choice: "ai_assistant", requestId: randomUUID() }),
    });
    check(accepted.status === 200, "Bound declaration failed.");
    const declaration = await accepted.json();
    const verified = await verifyDeclarationOnline(declaration.receipt, options);
    check(verified.sessionId === bound.sessionId, "Verified session mismatch.");
    check((await revoke(bound)).status === 204, "Bound revocation failed.");
    let rejected = false;
    try {
      await verifyDeclarationOnline(declaration.receipt, options);
    } catch {
      rejected = true;
    }
    check(rejected, "A revoked declaration passed online verification.");
    report.sessions.push({
      sessionId: declaration.sessionId,
      eventId: declaration.eventId,
      siteId: "parallel",
      origin,
      choice: declaration.choice,
    });
    report.checks.push("bound-session-online-verified", "revoked-receipt-rejected");

    currentStep = "private-event-export";
    const exported = await request("/v1/events?siteId=parallel&limit=1000", {
      headers: { Authorization: `Bearer ${secret}` },
    });
    check(exported.ok, "Private event export failed.");
    const data = await exported.json();
    check(Array.isArray(data.events), "Event export is malformed.");
    const expectedIds = [parallelDeclaration.eventId, declaration.eventId];
    for (const eventId of expectedIds) {
      const event = data.events.find((candidate) => candidate.id === eventId);
      check(
        event?.siteId === "parallel" && event.origin === origin && event.choice === "ai_assistant",
        "A smoke declaration is missing from private event export.",
      );
    }
    const allowedKeys = new Set([
      "id",
      "siteId",
      "origin",
      "sessionId",
      "choice",
      "evidence",
      "createdAt",
    ]);
    check(
      data.events.every((event) => Object.keys(event).every((key) => allowedKeys.has(key))),
      "Event export includes unexpected fields.",
    );
    report.checks.push("private-export-matches-browser-and-bound-events");
  } else {
    report.serverSecretChecks = "skipped: AGENT_ID_SITE_SECRET was not supplied";
  }
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failedStep = currentStep;
  report.failureType = error instanceof Error ? error.name : "UnknownError";
  if (error instanceof SmokeCheckError) report.failure = error.message;
  process.exitCode = 1;
} finally {
  const captured = await Promise.allSettled(pendingCaptures);
  if (captured.some((result) => result.status === "rejected")) {
    report.status = "failed";
    report.captureFailure = true;
    process.exitCode = 1;
  }
  await browser?.close();
  for (const session of sessions.values()) {
    try {
      const response = await revoke(session);
      report.cleanup.push({ sessionId: session.sessionId, revoked: response.status === 204 });
      if (response.status !== 204) {
        report.status = "failed";
        process.exitCode = 1;
      }
    } catch {
      report.cleanup.push({ sessionId: session.sessionId, revoked: false });
      report.status = "failed";
      process.exitCode = 1;
    }
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(
    `Hosted smoke ${report.status}; ${report.checks.length} checks; ${report.cleanup.filter((item) => item.revoked).length}/${report.cleanup.length} observed sessions revoked. Report: ${reportPath}`,
  );
  if (report.failedStep)
    console.error(`Failed at: ${report.failedStep}. No credentials were logged.`);
}
