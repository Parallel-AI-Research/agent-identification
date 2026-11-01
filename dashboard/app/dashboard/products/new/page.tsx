"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SecretOnce } from "@/components/secret-once";
import { Button, Card, Field, Notice, TextArea } from "@/components/ui";
import { createProduct } from "../actions";

export default function NewProductPage() {
  const [state, action, pending] = useActionState(createProduct, {});
  if (state.product && state.serverSecret) {
    return (
      <>
        <h1 className="mb-6 text-xl font-semibold">{state.product.name} is ready</h1>
        <Card className="space-y-4">
          <SecretOnce secret={state.serverSecret} />
          <Link
            className="inline-flex h-9 items-center rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground"
            href={`/dashboard/products/${state.product.id}`}
          >
            Continue to install
          </Link>
        </Card>
      </>
    );
  }
  return (
    <>
      <h1 className="mb-6 text-xl font-semibold">Add a product</h1>
      <Card>
        <form action={action} className="space-y-4">
          {state.error ? <Notice tone="error">{state.error}</Notice> : null}
          <Field label="Product name" name="name" maxLength={100} required />
          <TextArea
            label="Website origins"
            name="origins"
            rows={3}
            required
            placeholder={"https://example.com\nhttps://www.example.com"}
            hint="One per line, exactly as they appear in the browser, with no path. https://example.com and https://www.example.com are separate origins."
          />
          <Button disabled={pending}>{pending ? "Creating…" : "Create product"}</Button>
        </form>
      </Card>
    </>
  );
}
