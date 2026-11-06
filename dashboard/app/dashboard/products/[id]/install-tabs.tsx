"use client";

import { useState } from "react";
import { CopyBlock } from "@/components/copy-block";
import {
  httpSnippet,
  nextSnippet,
  nodeSnippet,
  packageSnippet,
  reactSnippet,
  scriptSnippet,
  serverSnippet,
  type InstallValues,
} from "@/lib/snippets";

const TABS = {
  server: [
    {
      label: "Next.js",
      build: nextSnippet,
      note: "Add it to proxy.ts. Your server needs AGENT_ID_SITE_SECRET set to your server secret.",
    },
    {
      label: "Node.js",
      build: nodeSnippet,
      note: "Express middleware, or the same two calls in any Node.js request handler. Your server needs AGENT_ID_SITE_SECRET set to your server secret.",
    },
    {
      label: "Any server",
      build: httpSnippet,
      note: "Two server-to-server requests, for any language. Send them in the background so visitors never wait.",
    },
  ],
  widget: [
    {
      label: "Script tag",
      build: scriptSnippet,
      note: "For any website. Paste it into your page.",
    },
    { label: "JavaScript", build: packageSnippet, note: "For bundled apps." },
    { label: "React", build: reactSnippet, note: "For React and Next.js apps." },
    {
      label: "Server",
      build: serverSnippet,
      note: "Optional. Ties a declaration to your signed-in session and protects actions. Needs the server secret.",
    },
  ],
};

export function InstallTabs({ values, kind }: { values: InstallValues; kind: keyof typeof TABS }) {
  const tabs = TABS[kind];
  const [active, setActive] = useState(0);
  const tab = tabs[active]!;
  return (
    <>
      <div role="tablist" className="mb-3 flex flex-wrap gap-1">
        {tabs.map(({ label }, index) => (
          <button
            key={label}
            role="tab"
            type="button"
            aria-selected={index === active}
            onClick={() => setActive(index)}
            className={`cursor-pointer rounded-md px-3 py-1.5 text-sm ${
              index === active ? "bg-accent font-medium text-accent-foreground" : "hover:bg-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mb-2 text-sm text-muted-foreground">{tab.note}</p>
      <CopyBlock value={tab.build(values)} />
    </>
  );
}
