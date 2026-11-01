import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <Link className="mb-6 text-sm font-semibold text-primary" href="/">
        Agent analytics
      </Link>
      {children}
    </main>
  );
}
