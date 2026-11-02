"use server";

import { revalidatePath } from "next/cache";
import {
  collector,
  CollectorError,
  type Domain,
  type Environment,
  type Product,
} from "@/lib/collector";
import { parseOrigins } from "@/lib/snippets";

export interface ProductState {
  error?: string;
  success?: string;
  product?: Product;
  environment?: Environment;
  serverSecret?: string;
}

async function attempt(work: () => Promise<ProductState>): Promise<ProductState> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CollectorError) return { error: error.message };
    throw error;
  }
}

export async function createProduct(_: ProductState, form: FormData): Promise<ProductState> {
  return attempt(async () => {
    const created = await collector<{ product: Product; serverSecret: string }>("/products", {
      method: "POST",
      body: JSON.stringify({
        name: String(form.get("name") ?? ""),
        origins: parseOrigins(String(form.get("origins") ?? "")),
      }),
    });
    revalidatePath("/dashboard");
    return created;
  });
}

export async function addEnvironment(
  productId: string,
  _: ProductState,
  form: FormData,
): Promise<ProductState> {
  return attempt(async () => {
    const created = await collector<{ environment: Environment; serverSecret: string }>(
      `/products/${productId}/environments`,
      {
        method: "POST",
        body: JSON.stringify({
          type: String(form.get("type") ?? ""),
          origins: parseOrigins(String(form.get("origins") ?? "")),
        }),
      },
    );
    revalidatePath(`/dashboard/products/${productId}`);
    return created;
  });
}

const environmentPath = (productId: string, environmentId: string) =>
  `/products/${productId}/environments/${environmentId}`;

export async function updateOrigins(
  productId: string,
  environmentId: string,
  _: ProductState,
  form: FormData,
): Promise<ProductState> {
  return attempt(async () => {
    await collector(environmentPath(productId, environmentId), {
      method: "PATCH",
      body: JSON.stringify({ origins: parseOrigins(String(form.get("origins") ?? "")) }),
    });
    revalidatePath(`/dashboard/products/${productId}`);
    return { success: "Origins saved. Changes reach the collector within 30 seconds." };
  });
}

export async function rotateSecret(
  productId: string,
  environmentId: string,
): Promise<ProductState> {
  return attempt(async () => {
    const { serverSecret } = await collector<{ serverSecret: string }>(
      `${environmentPath(productId, environmentId)}/secret`,
      { method: "POST" },
    );
    revalidatePath(`/dashboard/products/${productId}`);
    return { serverSecret };
  });
}

export async function revokeOldSecret(
  productId: string,
  environmentId: string,
): Promise<ProductState> {
  return attempt(async () => {
    await collector(`${environmentPath(productId, environmentId)}/secret/previous`, {
      method: "DELETE",
    });
    revalidatePath(`/dashboard/products/${productId}`);
    return { success: "The old secret has been revoked." };
  });
}

export async function verifyDomain(
  productId: string,
  environmentId: string,
  domain: string,
): Promise<ProductState> {
  return attempt(async () => {
    await collector<{ domain: Domain }>(
      `${environmentPath(productId, environmentId)}/domains/verify`,
      { method: "POST", body: JSON.stringify({ domain }) },
    );
    revalidatePath(`/dashboard/products/${productId}`);
    return { success: `${domain} is verified.` };
  });
}
