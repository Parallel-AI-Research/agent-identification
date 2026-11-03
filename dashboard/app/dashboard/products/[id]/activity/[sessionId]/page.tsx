import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import {
  collector,
  CollectorError,
  type ActivityItem,
  type Analytics,
  type Product,
} from "@/lib/collector";
import { pickEnvironment } from "@/lib/environments";
import { describe, EVIDENCE } from "@/lib/labels";
import { LabelBadge } from "../label-badge";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const time = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "UTC",
});

function Details({ event }: { event: ActivityItem }) {
  const lines: string[] = [];
  if (event.type === "declaration" && event.agent) {
    const { name, provider, purpose } = event.agent;
    if (name || provider || purpose) {
      lines.push(
        `Described itself as ${[name, provider && `from ${provider}`, purpose && `to ${purpose}`]
          .filter(Boolean)
          .join(" ")}. Self-reported.`,
      );
    }
  }
  if (event.accountRef) {
    lines.push(`Account used: ${event.accountRef}. This says which account acted, not who asked.`);
  }
  if (event.type === "action" && event.resourceRef) lines.push(`On ${event.resourceRef}.`);
  if (event.type === "signature" && event.verifier) lines.push(`Checked by ${event.verifier}.`);
  if (!lines.length) return null;
  return (
    <ul className="mt-1 text-xs text-muted-foreground">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; sessionId: string }>;
  searchParams: Promise<{ env?: string }>;
}) {
  const { id, sessionId } = await params;
  const { env } = await searchParams;
  if (!UUID.test(sessionId)) notFound();
  let product: Product;
  let analytics: Analytics;
  let events: ActivityItem[];
  try {
    ({ product } = await collector<{ product: Product }>(`/products/${id}`));
    const environment = pickEnvironment(product, env);
    const path = `/products/${id}/environments/${environment.id}`;
    [analytics, { events }] = await Promise.all([
      collector<Analytics>(`${path}/analytics?range=30d&sessionId=${sessionId}`),
      collector<{ events: ActivityItem[] }>(`${path}/activity?sessionId=${sessionId}&limit=1000`),
    ]);
  } catch (error) {
    if (error instanceof CollectorError && error.status === 404) notFound();
    throw error;
  }
  const summary = analytics.sessions[0];
  if (!summary) notFound();
  const environment = pickEnvironment(product, env);
  const timeline = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          className="text-sm text-muted-foreground hover:text-foreground"
          href={`/dashboard/products/${product.id}/activity?env=${environment.id}`}
        >
          {product.name} activity
        </Link>
        <h1 className="text-xl font-semibold">Session</h1>
        <p className="text-sm text-muted-foreground">
          <code className="font-mono">{summary.sessionId}</code> on{" "}
          {summary.origin ?? "your server"} in {environment.name}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <LabelBadge label={summary.label} />
        </div>
      </div>
      {summary.conflicts.length ? (
        <Card>
          <h2 className="font-semibold">Conflicting signals</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            These are shown as they are, not resolved.
          </p>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {summary.conflicts.map((conflict) => (
              <li key={conflict}>{conflict}</li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card>
        <h2 className="font-semibold">Timeline</h2>
        <ol className="mt-3 divide-y divide-border text-sm">
          {timeline.map((event) => (
            <li key={event.id} className="flex flex-wrap justify-between gap-2 py-2.5">
              <div>
                <p className="font-medium">{describe(event)}</p>
                <p className="text-xs text-muted-foreground">
                  {EVIDENCE[event.evidence] ?? event.evidence}
                </p>
                <Details event={event} />
              </div>
              <time className="text-muted-foreground" dateTime={event.occurredAt}>
                {time.format(new Date(event.occurredAt))} UTC
              </time>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
