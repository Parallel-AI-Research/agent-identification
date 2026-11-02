"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui";

export function CheckAgain() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="secondary" disabled={pending} onClick={() => start(() => router.refresh())}>
      {pending ? "Checking…" : "Check again"}
    </Button>
  );
}
