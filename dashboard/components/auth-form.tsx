"use client";

import { useActionState, type ReactNode } from "react";
import type { AuthState } from "@/app/auth-actions";
import { Button, Notice } from "./ui";

export function AuthForm({
  action,
  submit,
  children,
}: {
  action: (state: AuthState, form: FormData) => Promise<AuthState>;
  submit: string;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  if (state.success) return <Notice tone="success">{state.success}</Notice>;
  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {children}
      <Button className="w-full" disabled={pending}>
        {pending ? "Working…" : submit}
      </Button>
    </form>
  );
}
