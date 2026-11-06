export interface InstallValues {
  siteId: string;
  collectorUrl: string;
}
const VERSION = "0.5.0";

function packageUrl(collectorUrl: string): string {
  return `${collectorUrl}/downloads/parallel-research-agent-identification-${VERSION}.tgz`;
}

function serverOptions({ siteId, collectorUrl }: InstallValues): string {
  return `const agentId = {
  apiUrl: "${collectorUrl}",
  siteId: "${siteId}",
  secret: process.env.AGENT_ID_SITE_SECRET!,
};`;
}

/** The default install: the customer's server reports agents, and pages stay unchanged. */
export function nodeSnippet(values: InstallValues): string {
  return `npm install ${packageUrl(values.collectorUrl)}

import {
  reportRequestSignals,
  reportSignedRequest,
} from "@parallel-research/agent-identification/server";

${serverOptions(values)}

// Express. Both calls skip ordinary requests and never throw, so don't wait for them.
app.use((req, res, next) => {
  void reportSignedRequest(req, agentId);
  void reportRequestSignals(req, agentId);
  next();
});`;
}

export function nextSnippet(values: InstallValues): string {
  return `npm install ${packageUrl(values.collectorUrl)}

// proxy.ts, which runs on Node.js
import {
  reportRequestSignals,
  reportSignedRequest,
} from "@parallel-research/agent-identification/server";
import type { NextFetchEvent, NextRequest } from "next/server";

${serverOptions(values)}

export function proxy(request: NextRequest, event: NextFetchEvent) {
  // Next.js changes the request's URL to localhost, and an agent signs the host it asked for.
  const url = new URL(request.url);
  url.host = request.headers.get("host") ?? url.host;
  event.waitUntil(reportSignedRequest(request, { ...agentId, url: url.href }));
  event.waitUntil(reportRequestSignals(request, agentId));
}`;
}

export function httpSnippet({ siteId, collectorUrl }: InstallValues): string {
  return `# When a request has Signature and Signature-Input headers, send its method, the URL
# the visitor asked for, and the headers it signed:
curl ${collectorUrl}/v1/signatures \\
  -H "Authorization: Bearer $AGENT_ID_SITE_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{"siteId":"${siteId}","request":{"method":"GET","url":"https://your-site.example/pricing","headers":{"signature":"…","signature-input":"…","signature-agent":"…"}}}'

# When its user agent names an AI agent, such as ChatGPT-User or ClaudeBot:
curl ${collectorUrl}/v1/signals \\
  -H "Authorization: Bearer $AGENT_ID_SITE_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{"siteId":"${siteId}","signals":[{"id":"<a new UUID>","signal":"agent_user_agent","detail":"ChatGPT-User","occurredAt":"<now, ISO 8601>"}]}'`;
}

/** The opt-in declaration widget, which every visitor sees. */
export function scriptSnippet({ siteId, collectorUrl }: InstallValues): string {
  return `<div id="visitor-choice"></div>
<script
  defer
  src="${collectorUrl}/sdk/v${VERSION}/agent-id.js"
  data-site="${siteId}"
  data-target="#visitor-choice"
  data-mode="optional"
></script>`;
}

export function packageSnippet({ siteId, collectorUrl }: InstallValues): string {
  return `npm install ${packageUrl(collectorUrl)}

import { init } from "@parallel-research/agent-identification";

const widget = init({
  container: "#visitor-choice",
  siteId: "${siteId}",
  apiUrl: "${collectorUrl}",
  mode: "optional",
});
await widget.ready;`;
}

export function reactSnippet({ siteId, collectorUrl }: InstallValues): string {
  return `"use client";
import { AgentIdentification } from "@parallel-research/agent-identification/react";

export function VisitorChoice() {
  return (
    <AgentIdentification
      siteId="${siteId}"
      apiUrl="${collectorUrl}"
      mode="optional"
    />
  );
}`;
}

export function serverSnippet({ siteId, collectorUrl }: InstallValues): string {
  return `import {
  createBindingContext,
  verifyDeclarationOnline,
} from "@parallel-research/agent-identification/server";

const settings = {
  siteId: "${siteId}",
  origin: "https://your-website.example",
  secret: process.env.AGENT_ID_SITE_SECRET,
  sessionBinding: currentAuthenticatedSession.id,
};

// Return this from a same-origin endpoint and pass it to the widget.
const context = createBindingContext(settings);

// In a protected action, after your normal permission checks.
await verifyDeclarationOnline(receipt, {
  ...settings,
  apiUrl: "${collectorUrl}",
});`;
}

/**
 * A request the customer can send to check the install, from any machine. It claims a headless
 * browser rather than a real agent's name, so the check doesn't pose as that agent in their data.
 */
export function checkCommand(origin: string): string {
  return `curl -A "HeadlessChrome/1.0 (install check)" ${origin}/`;
}

/**
 * Instructions a customer can paste into their own coding agent. These hold only public
 * values, so the prompt is safe to share with any tool.
 */
export function agentPrompt(values: InstallValues, origins: string[], docsUrl: string): string {
  return `Add Agent Identification's server reporting to this project. It tells me which AI agents use the site, from the requests my server already receives. Nothing is added to the pages, and visitors see nothing.

Install details:
- Site ID: ${values.siteId}
- Collector: ${values.collectorUrl}
- Allowed origins: ${origins.join(", ")}

Steps:
1. Work out which server handles this site's requests, and where code can run on every request before the response: middleware, a request hook, or Next.js's proxy.ts.
2. If it's Next.js, add this to proxy.ts, or add its lines to the existing proxy function. On Next.js 15.5, the file is middleware.ts with a function named middleware and \`export const config = { runtime: "nodejs" };\`, because the server package needs Node.js.

${nextSnippet(values)}

3. If it's another Node.js server, add the two calls as middleware that runs on every request:

${nodeSnippet(values)}

4. If it isn't Node.js, send the same reports with an HTTP client, as in the docs: ${docsUrl}

5. Ask me to set AGENT_ID_SITE_SECRET myself. Then, with the site running, request a page as a headless browser, at its local address if it isn't deployed yet, and tell me to check that the dashboard's Status says Receiving events:

${checkCommand(origins[0] ?? "https://your-site.example")}

Rules:
- Don't add anything to the pages, and don't add the declaration widget. Every visitor would see it.
- Never commit the secret or put it in browser code. Read it from the AGENT_ID_SITE_SECRET environment variable.
- The site ID is public, so it's safe to commit.
- Don't wait for the reports before responding, and don't change how any request is handled.
- If a proxy or CDN in front of the server changes the Host header, pass the URL the visitor asked for as url to reportSignedRequest.
- A verified signature identifies the agent's operator, never the person it acts for. A user agent can be faked, so it's only a signal. Don't describe either as more than that.
- Tell me which files you changed and what you checked.

Full documentation is at ${docsUrl}.`;
}

/** Accepts origins separated by new lines, commas or spaces. */
export function parseOrigins(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).filter(Boolean))];
}
