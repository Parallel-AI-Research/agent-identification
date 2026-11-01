"use client";

import { useRef, useState } from "react";
import { Notice, Button } from "./ui";

function selectText(element: HTMLElement | null): void {
  if (!element) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Embedded browsers and strict settings can deny the clipboard, so this never assumes it worked. */
async function copyText(value: string, element: HTMLElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    selectText(element);
  }
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

export function CopyBlock({ value, label = "Copy" }: { value: string; label?: string }) {
  const [result, setResult] = useState<"idle" | "copied" | "blocked">("idle");
  const code = useRef<HTMLElement>(null);
  return (
    <div className="relative">
      <pre
        tabIndex={0}
        className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-[13px] leading-relaxed sm:pr-28"
      >
        <code ref={code}>{value}</code>
      </pre>
      <Button
        type="button"
        variant="secondary"
        className="mt-1.5 h-7 px-2 text-xs sm:absolute sm:top-2 sm:right-2 sm:mt-0"
        onClick={async () => {
          const copied = await copyText(value, code.current);
          setResult(copied ? "copied" : "blocked");
          if (copied) setTimeout(() => setResult("idle"), 1500);
        }}
      >
        {result === "copied" ? "Copied" : label}
      </Button>
      {result === "blocked" ? (
        <div className="mt-2">
          <Notice tone="warning">
            This browser blocked copying. The text is selected, so press Cmd+C or Ctrl+C.
          </Notice>
        </div>
      ) : null}
    </div>
  );
}
