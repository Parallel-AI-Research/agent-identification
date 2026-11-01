import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { collector, CollectorError, type Domain, type Product } from "@/lib/collector";
import { DomainList } from "./domain-list";
import { InstallTabs } from "./install-tabs";
import { OriginsForm } from "./origins-form";
import { SecretPanel } from "./secret-panel";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let product: Product;
  let domains: Domain[];
  try {
    ({ product } = await collector<{ product: Product }>(`/products/${id}`));
    ({ domains } = await collector<{ domains: Domain[] }>(`/products/${id}/domains`));
  } catch (error) {
    if (error instanceof CollectorError && error.status === 404) notFound();
    throw error;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{product.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Site ID: <code className="font-mono">{product.siteId}</code>. This ID is public.
        </p>
      </div>
      <Card>
        <h2 className="font-semibold">Install</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Add this to your site. It records what visitors choose to declare, so it can&apos;t detect
          every agent or prove who a visitor is.
        </p>
        <InstallTabs
          values={{ siteId: product.siteId, collectorUrl: process.env.COLLECTOR_URL! }}
        />
      </Card>
      <Card>
        <h2 className="font-semibold">Website origins</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Only these exact origins can use this product&apos;s site ID.
        </p>
        <OriginsForm id={product.id} origins={product.origins} />
      </Card>
      <Card>
        <h2 className="font-semibold">Domain verification</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Add a DNS record to show you control a domain. Events arrive either way, but an unverified
          domain stays labelled as unverified.
        </p>
        <DomainList id={product.id} domains={domains} />
      </Card>
      <Card>
        <h2 className="font-semibold">Server secret</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Server-only. Your backend uses it to sign sessions and verify declarations. It never goes
          in browser code.
        </p>
        <SecretPanel id={product.id} previousExpiresAt={product.previousSecretExpiresAt} />
      </Card>
    </div>
  );
}
