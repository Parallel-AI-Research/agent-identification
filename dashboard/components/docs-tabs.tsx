import Link from "next/link";

const TAB = "text-sm transition-colors hover:text-fd-accent-foreground";

/** The docs navbar puts its links on the right, so these sit beside the title instead. */
export function DocsTabs() {
  return (
    <div className="ms-6 flex items-center gap-6 max-lg:hidden">
      <Link className={`${TAB} text-fd-primary`} href="/docs">
        Docs
      </Link>
      <Link className={`${TAB} text-fd-muted-foreground`} href="/changelog">
        Changelog
      </Link>
    </div>
  );
}
