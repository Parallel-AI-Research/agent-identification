import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        It may not exist, or it may belong to another account.
      </p>
      <Link className="mt-6 inline-block text-sm text-primary underline" href="/products">
        Back to your products
      </Link>
    </main>
  );
}
