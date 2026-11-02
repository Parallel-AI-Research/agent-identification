export interface InstallValues {
  siteId: string;
  collectorUrl: string;
}
const VERSION = "0.2.0";

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
  return `npm install ${collectorUrl}/downloads/parallel-research-agent-identification-${VERSION}.tgz

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
 * Instructions a customer can paste into their own coding agent. These hold only public
 * values, so the prompt is safe to share with any tool.
 */
export function agentPrompt(values: InstallValues, origins: string[], docsUrl: string): string {
  return `Add the Agent Identification widget to this website.

Install details:
- Site ID: ${values.siteId}
- Collector: ${values.collectorUrl}
- Allowed origins: ${origins.join(", ")}

Steps:
1. Work out how this project renders its pages, and which layout or template every page shares.
2. If it's a React or Next.js app, install the package and render the component from a client component in the shared layout:

npm install ${values.collectorUrl}/downloads/parallel-research-agent-identification-${VERSION}.tgz

${reactSnippet(values)}

3. Otherwise, add this to the shared template, near the end of the body:

${scriptSnippet(values)}

4. Keep the mode optional, and don't gate or change any existing behaviour.
5. Load a page from an allowed origin and check that the prompt appears. Choose an option and check that it says "Response recorded".

Rules:
- The site ID is public, so it's safe to commit.
- Only the origins above can use this site ID. A local URL won't work unless it's listed, so tell me if you need one added.
- If the site has a Content Security Policy, allow ${values.collectorUrl} in script-src, style-src and connect-src.
- Don't add server verification unless I ask. If I do, read the secret from the AGENT_ID_SITE_SECRET environment variable, never commit it, and never put it in browser code. Ask me to set that variable myself.
- This records what visitors choose to declare. Don't describe it as detecting agents or proving who a visitor is.
- Tell me which files you changed and what you checked.

Full documentation is at ${docsUrl}.`;
}

/** Accepts origins separated by new lines, commas or spaces. */
export function parseOrigins(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).filter(Boolean))];
}
