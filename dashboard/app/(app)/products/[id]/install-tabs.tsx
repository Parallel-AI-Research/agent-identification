"use client";

import { useState } from "react";
import { CopyBlock } from "@/components/copy-block";
import {
  packageSnippet,
  reactSnippet,
  scriptSnippet,
  serverSnippet,
  type InstallValues,
} from "@/lib/snippets";

const TABS = [
  { label: "Script tag", build: scriptSnippet, note: "For any website. Paste it into your page." },
  { label: "JavaScript", build: packageSnippet, note: "For bundled apps." },
  { label: "React", build: reactSnippet, note: "For React and Next.js apps." },
  {
    label: "Server",
    build: serverSnippet,
    note: "Optional. Ties a declaration to your signed-in session and protects actions. Needs the server secret.",
  },
];

export function InstallTabs({ values }: { values: InstallValues }) {
  const [active, setActive] = useState(0);
  const tab = TABS[active]!;
  return (
    <>
      <div role="tablist" className="mb-3 flex flex-wrap gap-1">
        {TABS.map(({ label }, index) => (
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
