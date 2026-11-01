import Link from "next/link";

const STEPS = [
  {
    title: "Add a product",
    text: "Create an account, name your product and list the exact origins it runs on.",
  },
  {
    title: "Install the widget",
    text: "Paste a script tag, use the package, or hand the instructions to your coding agent.",
  },
  {
    title: "See what's declared",
    text: "Visitors choose AI assistant, Person or Prefer not to say, and each answer is recorded for your product.",
  },
];
const LIMITS = [
  ["It records", "What a visitor chooses to tell you, and when."],
  ["It can check", "That a declaration belongs to the session your own server signed in."],
  ["It can't tell you", "Who a visitor really is, or anything about one who doesn't answer."],
  ["It doesn't detect", "Every agent. A visitor who says nothing stays unknown, never human."],
];

export default function HomePage() {
  const demo = process.env.COLLECTOR_URL;
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-16 sm:py-24">
      <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
        See how AI agents use your product
      </h1>
      <p className="mt-5 max-w-2xl text-lg text-fd-muted-foreground">
        Agent analytics starts with one small step: asking. Add a widget to your site, and visitors
        can tell you whether they&apos;re an AI assistant or a person. No changes for agent
        builders, and nothing for visitors to install.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          className="inline-flex h-10 items-center rounded-md bg-fd-primary px-4 text-sm font-medium text-fd-primary-foreground"
          href="/docs/quickstart"
        >
          Read the quickstart
        </Link>
        {demo ? (
          <a
            className="inline-flex h-10 items-center rounded-md border bg-fd-card px-4 text-sm font-medium"
            href={demo}
          >
            Try the demo
          </a>
        ) : null}
      </div>

      <section className="mt-20">
        <h2 className="text-xl font-semibold">How it works</h2>
        <ol className="mt-5 grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="rounded-lg border bg-fd-card p-5">
              <p className="text-sm text-fd-muted-foreground">Step {index + 1}</p>
              <p className="mt-1 font-medium">{step.title}</p>
              <p className="mt-2 text-sm text-fd-muted-foreground">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-16">
        <h2 className="text-xl font-semibold">What it can and can&apos;t tell you</h2>
        <p className="mt-2 max-w-2xl text-fd-muted-foreground">
          A declaration is self-reported. We&apos;d rather show you an honest unknown than a
          confident guess.
        </p>
        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          {LIMITS.map(([term, detail]) => (
            <div key={term} className="rounded-lg border bg-fd-card p-5">
              <dt className="font-medium">{term}</dt>
              <dd className="mt-1 text-sm text-fd-muted-foreground">{detail}</dd>
            </div>
          ))}
        </dl>
        <Link className="mt-4 inline-block text-sm text-fd-primary underline" href="/docs/limits">
          Read more about the limits
        </Link>
      </section>

      <section className="mt-16 rounded-lg border bg-fd-card p-6">
        <h2 className="text-xl font-semibold">Still being built</h2>
        <p className="mt-2 max-w-2xl text-fd-muted-foreground">
          Declarations, accounts and installation work today. Activity tracking and dashboard
          analytics are next, and the{" "}
          <Link className="text-fd-primary underline" href="/changelog">
            changelog
          </Link>{" "}
          shows what&apos;s shipped.
        </p>
      </section>
    </main>
  );
}
