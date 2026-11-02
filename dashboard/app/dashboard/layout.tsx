import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";
import { signOut } from "@/app/auth-actions";
import { AccountMenu } from "@/components/account-menu";
import { DashboardMenuLink, DashboardTab } from "@/components/dashboard-links";
import { Button } from "@/components/ui";
import { baseOptions } from "@/lib/layout.shared";
import { supabaseServer } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  const email = String(data?.claims.email ?? "");
  const { links = [], ...options } = baseOptions();
  return (
    <HomeLayout
      {...options}
      links={[
        ...links,
        // The menu lists these on phones only; wider screens show Docs and Changelog in the navbar.
        { type: "custom", on: "menu", children: <DashboardMenuLink className="inline-flex" /> },
        { type: "custom", on: "menu", children: <hr className="mt-2 border-fd-border" /> },
        { type: "custom", secondary: true, on: "nav", children: <DashboardTab /> },
        { type: "custom", secondary: true, on: "nav", children: <AccountMenu email={email} /> },
        {
          type: "custom",
          secondary: true,
          on: "menu",
          children: (
            <div className="space-y-2 px-1.5">
              {/* Tablets have no navbar tab, and phones already list it above. */}
              <DashboardMenuLink className="block max-sm:hidden" />
              <form action={signOut} className="space-y-2">
                <p className="truncate text-sm text-muted-foreground">{email}</p>
                <Button variant="secondary">Sign out</Button>
              </form>
            </div>
          ),
        },
      ]}
    >
      <main className="mx-auto w-full max-w-3xl px-4 py-8">{children}</main>
    </HomeLayout>
  );
}
