import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";
import { signOut } from "@/app/auth-actions";
import { AccountMenu } from "@/components/account-menu";
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
        { type: "custom", secondary: true, on: "nav", children: <AccountMenu email={email} /> },
        {
          type: "custom",
          secondary: true,
          on: "menu",
          children: (
            <form action={signOut} className="w-full space-y-2 px-1.5">
              <p className="truncate text-sm text-muted-foreground">{email}</p>
              <Button variant="secondary" className="w-full">
                Sign out
              </Button>
            </form>
          ),
        },
      ]}
    >
      <main className="mx-auto w-full max-w-3xl px-4 py-8">{children}</main>
    </HomeLayout>
  );
}
