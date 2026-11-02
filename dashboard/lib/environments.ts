import type { Environment, Product } from "./collector";

export const ENVIRONMENT_TYPES = ["production", "beta", "staging", "dev"] as const;

/** The environment named in the URL, or production, which every product has and lists first. */
export function pickEnvironment(product: Product, id: string | undefined): Environment {
  return product.environments.find((item) => item.id === id) ?? product.environments[0]!;
}
