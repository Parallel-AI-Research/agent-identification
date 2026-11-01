export interface InstallValues {
  siteId: string;
  collectorUrl: string;
}
const VERSION = "0.1.0";

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

/** Accepts origins separated by new lines, commas or spaces. */
export function parseOrigins(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).filter(Boolean))];
}
