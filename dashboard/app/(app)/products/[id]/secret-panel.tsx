"use client";

import { useState, useTransition } from "react";
import { SecretOnce } from "@/components/secret-once";
import { Button, Notice } from "@/components/ui";
import { revokeOldSecret, rotateSecret, type ProductState } from "../actions";

export function SecretPanel({
  productId,
  environmentId,
  previousExpiresAt,
}: {
  productId: string;
  environmentId: string;
  previousExpiresAt: string | null;
}) {
  const [result, setResult] = useState<ProductState>({});
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const run = (work: () => Promise<ProductState>) =>
    start(async () => {
      setResult(await work());
      setConfirming(false);
    });
  return (
    <div className="space-y-3">
      {result.error ? <Notice tone="error">{result.error}</Notice> : null}
      {result.success ? <Notice tone="success">{result.success}</Notice> : null}
      {result.serverSecret ? <SecretOnce secret={result.serverSecret} /> : null}
      {previousExpiresAt ? (
        <>
          <p className="text-sm text-muted-foreground">
            Your old secret keeps working until{" "}
            <time dateTime={previousExpiresAt}>{new Date(previousExpiresAt).toUTCString()}</time>,
            so you can deploy the new one. Revoke it now if it may have leaked.
          </p>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => run(() => revokeOldSecret(productId, environmentId))}
          >
            Revoke old secret now
          </Button>
        </>
      ) : confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm">The old secret will keep working for 24 hours.</p>
          <Button
            disabled={pending}
            onClick={() => run(() => rotateSecret(productId, environmentId))}
          >
            Rotate now
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          Rotate secret
        </Button>
      )}
    </div>
  );
}
