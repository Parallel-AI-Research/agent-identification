import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/auth-actions";
import { Button } from "@/components/ui";
import { supabaseServer } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  return (
    <>
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-4">
          <Link className="shrink-0 text-sm font-semibold text-primary" href="/products">
            Agent analytics
          </Link>
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate text-sm text-muted-foreground">
              {String(data?.claims.email ?? "")}
            </span>
            <form action={signOut}>
              <Button variant="secondary" className="h-8 whitespace-nowrap">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </>
  );
}
