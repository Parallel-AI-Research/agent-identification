import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EnvironmentSwitcher } from "@/components/environment-switcher";
import { Badge, Card, Notice } from "@/components/ui";
import {
  collector,
  CollectorError,
  type Analytics,
  type Environment,
  type Product,
  type SessionSummary,
} from "@/lib/collector";
import { pickEnvironment } from "@/lib/environments";
import { LABELS } from "@/lib/labels";
import { ago } from "@/lib/time";
import { LabelBadge } from "./label-badge";

const RANGES = { "24h": "24 hours", "7d": "7 days", "30d": "30 days" } as const;
type Range = keyof typeof RANGES;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function Stat({ name, value, detail }: { name: string; value: number; detail?: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-sm text-muted-foreground">{name}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString("en")}</p>
      {detail ? <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

export default async function ActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ env?: string; range?: string; session?: string }>;
}) {
  const { id } = await params;
  const { env, range: requested, session } = await searchParams;
  const range: Range = requested && requested in RANGES ? (requested as Range) : "7d";
  let product: Product;
  let products: Product[];
  let environment: Environment;
  let analytics: Analytics;
  try {
    [{ product }, { products }] = await Promise.all([
      collector<{ product: Product }>(`/products/${id}`),
      collector<{ products: Product[] }>("/products"),
    ]);
    environment = pickEnvironment(product, env);
    analytics = await collector<Analytics>(
      `/products/${id}/environments/${environment.id}/analytics?range=${range}`,
    );
  } catch (error) {
    if (error instanceof CollectorError && error.status === 404) notFound();
    throw error;
  }
  const base = `/dashboard/products/${product.id}/activity`;
  let lookupError: string | null = null;
  if (session !== undefined) {
    const value = session.trim().toLowerCase();
    if (UUID.test(value)) redirect(`${base}/${value}?env=${environment.id}`);
    lookupError = "Enter a session ID: 36 characters, as the widget's getState() returns it.";
  }
  const { overview, sessions } = analytics;
  const now = Date.parse(analytics.checkedAt);
  const query = `&range=${range}`;
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          className="text-sm text-muted-foreground hover:text-foreground"
          href={`/dashboard/products/${product.id}?env=${environment.id}`}
        >
          {product.name}
        </Link>
        <h1 className="text-xl font-semibold">Activity</h1>
        {products.length > 1 ? (
          <nav aria-label="Product" className="flex flex-wrap gap-1.5 text-sm">
            {products.map((item) => (
              <Link
                key={item.id}
                href={`/dashboard/products/${item.id}/activity?range=${range}`}
                aria-current={item.id === product.id ? "page" : undefined}
                className={
                  item.id === product.id
                    ? "font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }
              >
                {item.name}
              </Link>
            ))}
          </nav>
        ) : null}
        <EnvironmentSwitcher product={product} current={environment} base={base} query={query} />
        <nav aria-label="Period" className="flex gap-3 text-sm">
          {(Object.keys(RANGES) as Range[]).map((item) => (
            <Link
              key={item}
              href={`${base}?env=${environment.id}&range=${item}`}
              aria-current={item === range ? "page" : undefined}
              className={
                item === range
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }
            >
              Last {RANGES[item]}
            </Link>
          ))}
        </nav>
      </div>

      {environment.install.status === "waiting" ? (
        <Notice tone="warning">
          Nothing has reported to {environment.name} yet. See Status on the product page to check
          your install.
        </Notice>
      ) : null}
      {analytics.truncated ? (
        <Notice tone="warning">
          This period is busy, so these numbers cover its latest 10,000 events.
        </Notice>
      ) : null}

      <Card>
        <h2 className="font-semibold">Overview</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat name="Sessions" value={overview.sessions} />
          <Stat name="Page views" value={overview.pageViews} />
          <Stat
            name="Signed requests"
            value={overview.signedRequests.verified}
            detail={`verified, plus ${overview.signedRequests.unverified} not verified`}
          />
          <Stat
            name="Confirmed actions"
            value={overview.actions.confirmed}
            detail={`${overview.actions.attempted} attempted, ${overview.actions.rejected} rejected`}
          />
        </div>
        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {(Object.keys(LABELS) as SessionSummary["label"][]).map((label) => (
            <li key={label}>
              {LABELS[label]}: <span className="tabular-nums">{overview.labels[label]}</span>
            </li>
          ))}
        </ul>
        {overview.signals ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {overview.signals} automation {overview.signals === 1 ? "signal" : "signals"}: evidence
            of automation, never proof of an AI agent.
          </p>
        ) : null}
        {overview.withoutSession.actions ||
        overview.withoutSession.signedRequests ||
        overview.withoutSession.signals ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Your server also reported {overview.withoutSession.actions} actions,{" "}
            {overview.withoutSession.signedRequests} signed requests and{" "}
            {overview.withoutSession.signals} automation signals it couldn&apos;t link to a session.
          </p>
        ) : null}
      </Card>

      <Card>
        <h2 className="font-semibold">Sessions</h2>
        {sessions.length ? (
          <ul className="mt-3 divide-y divide-border text-sm">
            {sessions.map((item) => (
              <li key={item.sessionId}>
                <Link
                  href={`${base}/${item.sessionId}?env=${environment.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 hover:text-primary"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <LabelBadge label={item.label} />
                    {item.conflicts.length ? (
                      <Badge tone="warning">Conflicting signals</Badge>
                    ) : null}
                    <span className="text-muted-foreground">
                      {item.pageViews} page {item.pageViews === 1 ? "view" : "views"},{" "}
                      {item.actions.confirmed} confirmed{" "}
                      {item.actions.confirmed === 1 ? "action" : "actions"}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    {item.origin ?? "Server only"} · {ago(item.lastSeenAt, now)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No sessions in {environment.name} in the last {RANGES[range]}.
          </p>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold">Find a session</h2>
        <form className="mt-3 flex flex-wrap items-end gap-2" action={base}>
          <input type="hidden" name="env" value={environment.id} />
          <label className="block min-w-64 flex-1 text-sm font-medium">
            Session ID
            <input
              name="session"
              defaultValue={session ?? ""}
              className="mt-1.5 h-9 w-full rounded-md border border-input bg-card px-3 font-mono text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
          </label>
          <button className="inline-flex h-9 items-center rounded-md border border-input bg-card px-3.5 text-sm font-medium hover:bg-muted">
            Open
          </button>
        </form>
        {lookupError ? (
          <div className="mt-3">
            <Notice tone="error">{lookupError}</Notice>
          </div>
        ) : null}
      </Card>

      <p className="text-sm text-muted-foreground">
        Each session gets one label from the strongest evidence it has: a verified signature, then
        an AI assistant answer, then automation signals, then a Person answer, with every signal
        kept on its timeline. A session with no signal stays Unknown, which never means a person.
        Agents that don&apos;t sign, answer or show automation can&apos;t be told apart here.
      </p>
    </div>
  );
}
