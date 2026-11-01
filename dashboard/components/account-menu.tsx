"use client";

import { Popover, PopoverContent, PopoverTrigger } from "fumadocs-ui/components/ui/popover";
import { signOut } from "@/app/auth-actions";
import { Button } from "./ui";

export function AccountMenu({ email }: { email: string }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Account menu"
        className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full bg-fd-primary text-sm font-medium text-fd-primary-foreground transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {email.charAt(0).toUpperCase() || "?"}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3 p-3">
        <p className="truncate text-sm text-fd-muted-foreground">{email}</p>
        <form action={signOut}>
          <Button variant="secondary" className="w-full">
            Sign out
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
