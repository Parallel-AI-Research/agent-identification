import Link from "next/link";

const STEPS = [
  {
    title: "Add a product",
    text: "Create an account, name your product and list the exact origins it runs on.",
  },
  {
    title: "Report from your server",
    text: "Add two calls where your server handles requests, or hand the instructions to your coding agent. Your pages don't change.",
  },
  {
    title: "See which agents came",
    text: "Verified signers, suspected automation and the actions your server confirms, each labelled by its evidence.",
  },
];
const LIMITS = [
  [
    "It verifies",
    "Agents that sign their requests with Web Bot Auth, checked against their operator's published keys.",
  ],
  [
    "It flags",
    "Requests whose user agent names an AI agent, or a headless browser. Anyone can send those, so they're signals, not proof.",
  ],
  ["It can't tell you", "Who an agent acts for. A signature names its operator, never a person."],
  [
    "It doesn't detect",
    "Every agent. One that neither signs nor names itself stays unknown, never human.",
  ],
];

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-16 sm:py-24">
      <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
        See how AI agents use your product
      </h1>
      <p className="mt-5 max-w-2xl text-lg text-fd-muted-foreground">
        Your server tells the collector about agents in the requests it already receives. Signed
        agents are checked against their operator&apos;s keys, automation is flagged, and you see
        what each agent did. Nothing is added to your pages, so visitors see nothing.
      </p>
      <div className="mt-8">
        <Link
          className="inline-flex h-10 items-center rounded-md bg-fd-primary px-4 text-sm font-medium text-fd-primary-foreground"
          href="/docs/quickstart"
        >
          Read the quickstart
        </Link>
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
          A verified signature is evidence, and a user agent is only a claim. We&apos;d rather show
          you an honest unknown than a confident guess.
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
          Server reporting, signature checks, activity and the dashboard work today, and
          ChatGPT&apos;s cloud browser is the first verified signer. Recording page views without
          showing visitors anything is next, and the{" "}
          <Link className="text-fd-primary underline" href="/changelog">
            changelog
          </Link>{" "}
          shows what&apos;s shipped.
        </p>
      </section>
    </main>
  );
}
