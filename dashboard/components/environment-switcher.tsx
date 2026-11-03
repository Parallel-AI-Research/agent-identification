import Link from "next/link";
import type { Environment, Product } from "@/lib/collector";

/** Keeps the chosen environment in the URL, so a link or reload shows the same one. */
export function EnvironmentSwitcher({
  product,
  current,
  base,
  query = "",
}: {
  product: Product;
  current: Environment;
  base: string;
  query?: string;
}) {
  return (
    <nav aria-label="Environment" className="flex flex-wrap gap-1.5">
      {product.environments.map((item) => {
        const active = item.id === current.id;
        return (
          <Link
            key={item.id}
            href={`${base}?env=${item.id}${query}`}
            aria-current={active ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm transition ${
              active
                ? "border-primary bg-primary/10 font-medium text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {item.name}
          </Link>
        );
      })}
    </nav>
  );
}
