import Link from "next/link";
import { Badge } from "@/components/ui";
import type { SignedVisit } from "@/lib/collector";
import { ago } from "@/lib/time";

const REASONS: Record<Exclude<SignedVisit["result"], "verified">, string> = {
  unknown_signer: "Unknown signer",
  bad_signature: "Signature didn't match",
  expired: "Expired signature",
  replayed: "Reused signature",
  wrong_authority: "Signed for another site",
  malformed: "Incomplete signature",
  key_unavailable: "Signer's keys unavailable",
};
const VERIFIERS: Record<string, string> = {
  cloudflare: "Cloudflare",
  akamai: "Akamai",
  vercel: "Vercel",
};

function Verdict({ visit }: { visit: SignedVisit }) {
  if (visit.evidence === "signature_verified") return <Badge tone="success">Verified</Badge>;
  if (visit.evidence === "cdn_reported") {
    return (
      <Badge tone="success">Verified by {VERIFIERS[visit.verifier ?? ""] ?? "your CDN"}</Badge>
    );
  }
  return (
    <Badge tone="warning">
      {visit.result === "verified" ? "Unverified" : REASONS[visit.result]}
    </Badge>
  );
}

/** Requests that agents signed with Web Bot Auth, as your server reported them. */
export function SignedAgents({ visits, now }: { visits: SignedVisit[]; now: number }) {
  if (!visits.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No signed requests yet. Agents that sign their requests show up here once your server
        reports them.{" "}
        <Link className="text-primary underline" href="/docs/signed-agents">
          Set it up
        </Link>
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border text-sm">
      {visits.map((visit) => (
        <li key={visit.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span className="min-w-0">
            <span className="font-medium">
              {visit.signer ?? visit.signatureAgent ?? "Unknown signer"}
            </span>
            {visit.path ? (
              <>
                {" "}
                on <code className="font-mono">{visit.path}</code>
              </>
            ) : null}{" "}
            <span className="text-muted-foreground">{ago(visit.receivedAt, now)}</span>
          </span>
          <Verdict visit={visit} />
        </li>
      ))}
    </ul>
  );
}
