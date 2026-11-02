"use client";

import { Button, Notice } from "@/components/ui";

export default function ActivityError({ retry }: { error: Error; retry: () => void }) {
  return (
    <div className="space-y-3">
      <Notice tone="error">
        Activity couldn&apos;t load because the collector didn&apos;t answer. Nothing is lost; try
        again in a moment.
      </Notice>
      <Button variant="secondary" onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}
