"use client";

import { useState } from "react";
import { Button } from "./ui";

export function CopyBlock({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre
        tabIndex={0}
        className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-[13px] leading-relaxed sm:pr-28"
      >
        <code>{value}</code>
      </pre>
      <Button
        type="button"
        variant="secondary"
        className="mt-1.5 h-7 px-2 text-xs sm:absolute sm:top-2 sm:right-2 sm:mt-0"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : label}
      </Button>
    </div>
  );
}
