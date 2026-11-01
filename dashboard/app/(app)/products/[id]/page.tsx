import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import {
  collector,
  CollectorError,
  type Domain,
  type Environment,
  type Product,
} from "@/lib/collector";
import { AgentSetup } from "./agent-setup";
import { DomainList } from "./domain-list";
import { InstallTabs } from "./install-tabs";
import { OriginsForm } from "./origins-form";
import { SecretPanel } from "./secret-panel";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let product: Product;
  let environment: Environment;
  let domains: Domain[];
  try {
    ({ product } = await collector<{ product: Product }>(`/products/${id}`));
    // Environment switching arrives with the dashboard views, so this shows production.
    environment = product.environments[0]!;
    ({ domains } = await collector<{ domains: Domain[] }>(
      `/products/${id}/environments/${environment.id}/domains`,
    ));
  } catch (error) {
    if (error instanceof CollectorError && error.status === 404) notFound();
    throw error;
  }
  const install = { siteId: environment.siteId, collectorUrl: process.env.COLLECTOR_URL! };
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{product.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {environment.name} site ID: <code className="font-mono">{environment.siteId}</code>. This
          ID is public.
        </p>
      </div>
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
    </div>
  );
}
