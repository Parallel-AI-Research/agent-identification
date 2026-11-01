import { DocsBody } from "fumadocs-ui/layouts/docs/page";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMDXComponents } from "@/components/mdx";
import { changelog } from "@/lib/source";

interface Props {
  params: Promise<{ slug: string }>;
}

const format = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" });

export default async function ChangelogPost({ params }: Props) {
  const post = changelog.getPage([(await params).slug]);
  if (!post) notFound();
  const MDX = post.data.body;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16">
      <Link className="text-sm text-fd-primary underline" href="/changelog">
        All updates
      </Link>
      <time
        className="mt-6 block text-sm text-fd-muted-foreground"
        dateTime={post.data.date.toISOString()}
      >
        {format.format(post.data.date)}
      </time>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">{post.data.title}</h1>
      <DocsBody className="mt-6">
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </main>
  );
}

export function generateStaticParams() {
  return changelog.getPages().map((post) => ({ slug: post.slugs[0]! }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = changelog.getPage([(await params).slug]);
  if (!post) notFound();
  return { title: post.data.title, description: post.data.description };
}
