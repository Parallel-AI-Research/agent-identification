import Link from "next/link";
import { Card } from "@/components/ui";
import { collector, type DeletedProduct, type Product } from "@/lib/collector";
import { DeletedProducts } from "./deleted-products";
import { StatusBadges } from "./products/[id]/install-status";

export default async function ProductsPage() {
  const { products, deleted } = await collector<{
    products: Product[];
    deleted: DeletedProduct[];
  }>("/products");
  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Your products</h1>
        <Link
          className="inline-flex h-9 items-center rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground"
          href="/dashboard/products/new"
        >
          Add product
        </Link>
      </div>
      {products.length ? (
        <ul className="space-y-3">
          {products.map((product) => (
            <li key={product.id}>
              <Link href={`/dashboard/products/${product.id}`} className="block">
                <Card className="transition hover:border-primary/40">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{product.name}</p>
                    {product.environments[0] ? (
                      <StatusBadges install={product.environments[0].install} />
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {product.environments[0]?.origins.join(", ")}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Card className="text-center">
          <p className="font-medium">No products yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a product to get your installation snippet.
          </p>
        </Card>
      )}
      {deleted.length ? <DeletedProducts products={deleted} /> : null}
    </>
  );
}
