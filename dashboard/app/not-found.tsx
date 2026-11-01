import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This page may have moved, or the address may be mistyped.
      </p>
      <Link className="mt-6 inline-block text-sm text-primary underline" href="/">
        Back to the home page
      </Link>
    </main>
  );
}
