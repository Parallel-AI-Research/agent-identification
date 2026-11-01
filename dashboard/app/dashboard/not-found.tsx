import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-12 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        It may not exist, or it may belong to another account.
      </p>
      <Link className="mt-6 inline-block text-sm text-primary underline" href="/dashboard">
        Back to your products
      </Link>
    </div>
  );
}
