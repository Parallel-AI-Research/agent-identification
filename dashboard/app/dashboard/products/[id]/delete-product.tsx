"use client";

import { useActionState } from "react";
import { Button, Card, Field, Notice } from "@/components/ui";
import { deleteProduct } from "../actions";

export function DeleteProduct({ productId, name }: { productId: string; name: string }) {
  const [state, action, pending] = useActionState(deleteProduct.bind(null, productId, name), {});
  return (
    <Card>
      <h2 className="font-semibold">Delete this product</h2>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">
        This removes every environment, its site IDs and secrets, and everything they recorded.
        Installs stop working within 30 seconds. It can&apos;t be undone.
      </p>
      <form action={action} className="space-y-4">
        {state.error ? <Notice tone="error">{state.error}</Notice> : null}
        <Field label={`Type ${name} to confirm`} name="confirm" autoComplete="off" required />
        <Button variant="danger" disabled={pending}>
          {pending ? "Deleting…" : "Delete product"}
        </Button>
      </form>
    </Card>
  );
}
