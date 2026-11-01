import type { Metadata } from "next";
import Link from "next/link";
import { changelog } from "@/lib/source";

export const metadata: Metadata = {
  title: "Changelog",
  description: "New features, improvements and fixes.",
};

const format = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" });

export default function ChangelogPage() {
  const posts = changelog.getPages().sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Changelog</h1>
      <p className="mt-2 text-fd-muted-foreground">New features, improvements and fixes.</p>
      <ul className="mt-10 space-y-4">
        {posts.map((post) => (
          <li key={post.url}>
            <Link className="block rounded-lg border bg-fd-card p-5" href={post.url}>
              <time
                className="text-sm text-fd-muted-foreground"
                dateTime={post.data.date.toISOString()}
              >
                {format.format(post.data.date)}
              </time>
              <p className="mt-1 font-medium">{post.data.title}</p>
              <p className="mt-1 text-sm text-fd-muted-foreground">{post.data.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
