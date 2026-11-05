import Link from "next/link";
import { notFound } from "next/navigation";
import { EnvironmentSwitcher } from "@/components/environment-switcher";
import { Card, Notice } from "@/components/ui";
import {
  collector,
  CollectorError,
  type Domain,
  type Environment,
  type Product,
  type SignedVisit,
} from "@/lib/collector";
import { pickEnvironment } from "@/lib/environments";
import { AddEnvironment } from "./add-environment";
import { AgentSetup } from "./agent-setup";
import { DeleteProduct } from "./delete-product";
import { DomainList } from "./domain-list";
import { InstallStatusPanel, StatusBadges } from "./install-status";
import { InstallTabs } from "./install-tabs";
import { OriginsForm } from "./origins-form";
import { SecretPanel } from "./secret-panel";
import { SignedAgents } from "./signed-agents";

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ env?: string }>;
}) {
  const { id } = await params;
  const { env } = await searchParams;
  let product: Product;
  let environment: Environment;
  let domains: Domain[];
  let signed: SignedVisit[];
  try {
    ({ product } = await collector<{ product: Product }>(`/products/${id}`));
    environment = pickEnvironment(product, env);
    [{ domains }, { events: signed }] = await Promise.all([
      collector<{ domains: Domain[] }>(`/products/${id}/environments/${environment.id}/domains`),
      collector<{ events: SignedVisit[] }>(
        `/products/${id}/environments/${environment.id}/activity?type=signature&limit=20`,
      ),
    ]);
  } catch (error) {
    if (error instanceof CollectorError && error.status === 404) notFound();
    throw error;
  }
  const install = { siteId: environment.siteId, collectorUrl: process.env.COLLECTOR_URL! };
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">{product.name}</h1>
          <Link
            className="inline-flex h-9 items-center rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground"
            href={`/dashboard/products/${product.id}/activity?env=${environment.id}`}
          >
            Activity
          </Link>
        </div>
        <EnvironmentSwitcher
          product={product}
          current={environment}
          base={`/dashboard/products/${product.id}`}
        />
        <p className="text-sm text-muted-foreground">
          {environment.name} site ID: <code className="font-mono">{environment.siteId}</code>. This
          ID is public.
        </p>
      </div>
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Status</h2>
          <StatusBadges install={environment.install} />
        </div>
        <InstallStatusPanel install={environment.install} origins={environment.origins} />
      </Card>
      <Card>
        <h2 className="font-semibold">Signed agents</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Agents that sign their requests with Web Bot Auth, checked against the signer&apos;s
          published keys. A signature identifies the agent&apos;s operator, not who it acts for.
        </p>
        <SignedAgents visits={signed} now={Date.parse(environment.install.checkedAt)} />
      </Card>
      <Card>
        <h2 className="font-semibold">Install</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Your server reports agents from the requests it already receives: agents that sign their
          requests, and user agents that name an AI agent. Nothing is added to your pages, so
          visitors see nothing. Agents that do neither aren&apos;t caught this way.
        </p>
        <InstallTabs values={install} kind="server" />
        <AgentSetup values={install} origins={environment.origins} />
        <details className="mt-3 rounded-md border border-border">
          <summary className="cursor-pointer rounded-md px-3 py-2.5 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            Optional: the declaration widget
          </summary>
          <div className="space-y-3 px-3 pb-3">
            <Notice tone="warning">
              Every visitor sees this widget, people included. It asks whether they&apos;re an AI
              assistant or a person, and records what they choose to declare. Only add it where
              you&apos;re happy for everyone to see it.
            </Notice>
            <InstallTabs values={install} kind="widget" />
          </div>
        </details>
      </Card>
      <Card>
        <h2 className="font-semibold">Website origins</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          A signed request only verifies when it was signed for one of these exact origins, and only
          these can load the declaration widget.
        </p>
        <OriginsForm
          productId={product.id}
          environmentId={environment.id}
          origins={environment.origins}
        />
      </Card>
      <Card>
        <h2 className="font-semibold">Domain verification</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Add a DNS record to show you control a domain. Events arrive either way, but an unverified
          domain stays labelled as unverified.
        </p>
        <DomainList productId={product.id} environmentId={environment.id} domains={domains} />
      </Card>
      <Card>
        <h2 className="font-semibold">Server secret</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Server-only. Your server sends it with every report, and the declaration widget&apos;s
          server checks use it too. It never goes in browser code.
        </p>
        <SecretPanel
          productId={product.id}
          environmentId={environment.id}
          previousExpiresAt={environment.previousSecretExpiresAt}
        />
      </Card>
      <AddEnvironment product={product} />
      <DeleteProduct productId={product.id} name={product.name} />
    </div>
  );
}
