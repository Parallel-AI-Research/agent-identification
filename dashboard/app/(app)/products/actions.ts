"use server";

import { revalidatePath } from "next/cache";
import { collector, CollectorError, type Domain, type Product } from "@/lib/collector";
import { parseOrigins } from "@/lib/snippets";

export interface ProductState {
  error?: string;
  success?: string;
  product?: Product;
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
    revalidatePath("/products");
    return created;
  });
}

export async function updateOrigins(
  id: string,
  _: ProductState,
  form: FormData,
): Promise<ProductState> {
  return attempt(async () => {
    await collector(`/products/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ origins: parseOrigins(String(form.get("origins") ?? "")) }),
    });
    revalidatePath(`/products/${id}`);
    return { success: "Origins saved. Changes reach the collector within 30 seconds." };
  });
}

export async function rotateSecret(id: string): Promise<ProductState> {
  return attempt(async () => {
    const rotated = await collector<{ product: Product; serverSecret: string }>(
      `/products/${id}/secret`,
      { method: "POST" },
    );
    revalidatePath(`/products/${id}`);
    return rotated;
  });
}

export async function revokeOldSecret(id: string): Promise<ProductState> {
  return attempt(async () => {
    await collector(`/products/${id}/secret/previous`, { method: "DELETE" });
    revalidatePath(`/products/${id}`);
    return { success: "The old secret has been revoked." };
  });
}

export async function verifyDomain(id: string, domain: string): Promise<ProductState> {
  return attempt(async () => {
    await collector<{ domain: Domain }>(`/products/${id}/domains/verify`, {
      method: "POST",
      body: JSON.stringify({ domain }),
    });
    revalidatePath(`/products/${id}`);
    return { success: `${domain} is verified.` };
  });
}
