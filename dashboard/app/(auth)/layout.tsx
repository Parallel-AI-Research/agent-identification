import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <p className="mb-6 text-sm font-semibold text-primary">Agent analytics</p>
      {children}
    </main>
  );
}
