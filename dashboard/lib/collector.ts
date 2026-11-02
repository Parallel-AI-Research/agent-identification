import "server-only";
import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase/server";

export interface InstallIssue {
  signal: "origin_refused" | "secret_refused" | "binding_refused";
  origin: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}
/** Only traffic the collector received changes this. */
export interface InstallStatus {
  status: "waiting" | "receiving";
  loaded: { origin: string; firstSeenAt: string; lastSeenAt: string }[];
  lastDeclarationAt: string | null;
  /** The collector's time, which relative times are measured from. */
  checkedAt: string;
  issues: InstallIssue[];
}
export interface Environment {
  id: string;
  productId: string;
  type: "production" | "beta" | "staging" | "dev";
  name: string;
  siteId: string;
  origins: string[];
  previousSecretExpiresAt: string | null;
  install: InstallStatus;
  createdAt: string;
  updatedAt: string;
}
export interface Product {
  id: string;
  name: string;
  /** Production comes first. */
  environments: Environment[];
  createdAt: string;
  updatedAt: string;
}
export interface Domain {
  domain: string;
  status: "unverified" | "verified" | "not_applicable";
  record: { type: string; name: string; value: string } | null;
}

export class CollectorError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Calls the owner API as the signed-in customer. The collector enforces ownership. */
export async function collector<T>(path: string, init: RequestInit = {}): Promise<T> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getSession();
  if (!data.session) redirect("/sign-in");
  let response: Response;
  try {
    response = await fetch(`${process.env.COLLECTOR_URL}/v1/owner${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        authorization: `Bearer ${data.session.access_token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
  } catch {
    throw new CollectorError("The service is unavailable. Try again shortly.", 503);
  }
  if (response.status === 401) redirect("/sign-in");
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : "The service is unavailable. Try again shortly.";
    throw new CollectorError(message, response.status);
  }
  return payload as T;
}
