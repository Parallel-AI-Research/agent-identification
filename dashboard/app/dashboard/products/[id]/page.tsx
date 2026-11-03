import Link from "next/link";
import { notFound } from "next/navigation";
import { EnvironmentSwitcher } from "@/components/environment-switcher";
import { Card } from "@/components/ui";
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
        <InstallStatusPanel install={environment.install} />
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
          Add this to your site. It records what visitors choose to declare, so it can&apos;t detect
          every agent or prove who a visitor is.
        </p>
        <InstallTabs values={install} />
        <AgentSetup values={install} origins={environment.origins} />
      </Card>
      <Card>
        <h2 className="font-semibold">Website origins</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Only these exact origins can use this product&apos;s site ID.
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
          Server-only. Your backend uses it to sign sessions and verify declarations. It never goes
          in browser code.
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
