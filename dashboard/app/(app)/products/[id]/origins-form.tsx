"use client";

import { useActionState } from "react";
import { Button, Notice, TextArea } from "@/components/ui";
import { updateOrigins } from "../actions";

export function OriginsForm({ id, origins }: { id: string; origins: string[] }) {
  const [state, action, pending] = useActionState(updateOrigins.bind(null, id), {});
  return (
    <form action={action} className="space-y-3">
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.success ? <Notice tone="success">{state.success}</Notice> : null}
      <TextArea
        label="Origins"
        name="origins"
        rows={Math.max(2, origins.length)}
        defaultValue={origins.join("\n")}
        required
      />
      <Button variant="secondary" disabled={pending}>
        {pending ? "Saving…" : "Save origins"}
      </Button>
    </form>
  );
}
