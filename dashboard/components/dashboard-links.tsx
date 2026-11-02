import { NavigationMenuLink } from "fumadocs-ui/components/ui/navigation-menu";
import Link from "next/link";

/** Every page that shows this tab is in the dashboard, so it always reads as the current one. */
export function DashboardTab() {
  return (
    <Link className="inline-flex items-center p-2 text-sm text-fd-foreground" href="/dashboard">
      Dashboard
    </Link>
  );
}

/** Closes the menu when chosen, like the menu's own links. */
export function DashboardMenuLink({ className }: { className: string }) {
  return (
    <NavigationMenuLink asChild>
      <Link className={`py-1.5 text-fd-foreground ${className}`} href="/dashboard">
        Dashboard
      </Link>
    </NavigationMenuLink>
  );
}
