import Link from "next/link";

export function DashboardButton() {
  return (
    <Link
      className="inline-flex h-8 items-center rounded-md bg-fd-primary px-3 text-sm font-medium whitespace-nowrap text-fd-primary-foreground transition hover:opacity-90"
      href="/dashboard"
    >
      Dashboard
    </Link>
  );
}
