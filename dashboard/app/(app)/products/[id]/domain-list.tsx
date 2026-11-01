"use client";

import { useState, useTransition } from "react";
import { CopyBlock } from "@/components/copy-block";
import { Badge, Button, Notice } from "@/components/ui";
import type { Domain } from "@/lib/collector";
import { verifyDomain, type ProductState } from "../actions";

export function DomainList({ id, domains }: { id: string; domains: Domain[] }) {
  const [result, setResult] = useState<ProductState>({});
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      {result.error ? <Notice tone="error">{result.error}</Notice> : null}
      {result.success ? <Notice tone="success">{result.success}</Notice> : null}
      {domains.map((domain) => (
        <div key={domain.domain} className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm">{domain.domain}</span>
            {domain.status === "verified" ? <Badge tone="success">Verified</Badge> : null}
            {domain.status === "unverified" ? <Badge tone="warning">Unverified</Badge> : null}
            {domain.status === "not_applicable" ? <Badge tone="muted">Local address</Badge> : null}
          </div>
          {domain.status === "unverified" && domain.record ? (
            <>
              <p className="text-sm text-muted-foreground">Add this TXT record to your DNS:</p>
              <CopyBlock value={domain.record.name} label="Copy name" />
              <CopyBlock value={domain.record.value} label="Copy value" />
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => start(async () => setResult(await verifyDomain(id, domain.domain)))}
              >
                {pending ? "Checking…" : "Check DNS record"}
              </Button>
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}
