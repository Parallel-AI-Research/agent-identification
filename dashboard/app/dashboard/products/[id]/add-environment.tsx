"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SecretOnce } from "@/components/secret-once";
import { Button, Card, Notice, TextArea } from "@/components/ui";
import type { Product } from "@/lib/collector";
import { ENVIRONMENT_TYPES } from "@/lib/environments";
import { addEnvironment } from "../actions";

const NAMES = { production: "Production", beta: "Beta", staging: "Staging", dev: "Development" };

export function AddEnvironment({ product }: { product: Product }) {
  const [state, action, pending] = useActionState(addEnvironment.bind(null, product.id), {});
  const remaining = ENVIRONMENT_TYPES.filter(
    (type) => !product.environments.some((item) => item.type === type),
  );
  if (state.environment && state.serverSecret) {
    return (
      <Card className="space-y-4">
        <h2 className="font-semibold">{state.environment.name} is ready</h2>
        <SecretOnce secret={state.serverSecret} />
        <Link
          className="inline-flex h-9 items-center rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground"
          href={`/dashboard/products/${product.id}?env=${state.environment.id}`}
        >
          Open {state.environment.name} to copy its snippet
        </Link>
      </Card>
    );
  }
  if (!remaining.length) return null;
  return (
    <Card>
      <h2 className="font-semibold">Add an environment</h2>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">
        Each environment has its own site ID, secret and origins, and its analytics are kept
        separately.
      </p>
      <form action={action} className="space-y-4">
        {state.error ? <Notice tone="error">{state.error}</Notice> : null}
        <label className="block text-sm font-medium">
          Environment
          <select
            name="type"
            className="mt-1.5 h-9 w-full rounded-md border border-input bg-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {remaining.map((type) => (
              <option key={type} value={type}>
                {NAMES[type]}
              </option>
            ))}
          </select>
        </label>
        <TextArea
          label="Its website origins"
          name="origins"
          rows={2}
          required
          placeholder="https://staging.example.com"
          hint="One per line, exactly as they appear in the browser."
        />
        <Button variant="secondary" disabled={pending}>
          {pending ? "Adding…" : "Add environment"}
        </Button>
      </form>
    </Card>
  );
}
