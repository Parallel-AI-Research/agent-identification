"use client";

import { useState, useTransition } from "react";
import { Button, Card, Notice } from "@/components/ui";
import type { DeletedProduct } from "@/lib/collector";
import { deleteProductForGood, restoreProduct, type ProductState } from "./products/actions";

const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" });

export function DeletedProducts({ products }: { products: DeletedProduct[] }) {
  return (
    <section className="mt-10" aria-labelledby="recently-deleted">
      <h2 id="recently-deleted" className="font-semibold">
        Recently deleted
      </h2>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">
        A deleted product&apos;s installs are stopped. Restore it to start them again, with what its
        sites recorded that hasn&apos;t expired. After the date shown, it&apos;s removed for good.
      </p>
      <ul className="space-y-3">
        {products.map((product) => (
          <li key={product.id}>
            <DeletedProductRow product={product} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function DeletedProductRow({ product }: { product: DeletedProduct }) {
  const [result, setResult] = useState<ProductState>({});
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const run = (work: () => Promise<ProductState>) =>
    start(async () => {
      setResult(await work());
      setConfirming(false);
    });
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{product.name}</p>
          <p className="text-sm text-muted-foreground">
            <span className="whitespace-nowrap">
              Deleted{" "}
              <time dateTime={product.deletedAt}>{date.format(new Date(product.deletedAt))}</time>
            </span>{" "}
            ·{" "}
            <span className="whitespace-nowrap">
              Restorable until{" "}
              <time dateTime={product.restorableUntil}>
                {date.format(new Date(product.restorableUntil))}
              </time>
            </span>
          </p>
        </div>
        {confirming ? null : (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => run(() => restoreProduct(product.id))}
            >
              {pending ? "Restoring…" : "Restore"}
            </Button>
            <Button variant="danger" disabled={pending} onClick={() => setConfirming(true)}>
              Delete now
            </Button>
          </div>
        )}
      </div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm">
            This removes it and everything its sites recorded. It can&apos;t be undone.
          </p>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => run(() => deleteProductForGood(product.id))}
          >
            {pending ? "Deleting…" : "Delete for good"}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : null}
      {result.error ? <Notice tone="error">{result.error}</Notice> : null}
    </Card>
  );
}
