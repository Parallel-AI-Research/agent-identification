import { CopyBlock } from "@/components/copy-block";
import { Badge, Notice } from "@/components/ui";
import type { InstallIssue, InstallStatus } from "@/lib/collector";
import { checkCommand } from "@/lib/snippets";
import { ago } from "@/lib/time";
import { CheckAgain } from "./check-again";

export function StatusBadges({ install }: { install: InstallStatus }) {
  return (
    <span className="inline-flex flex-wrap gap-2">
      {install.status === "receiving" ? (
        <Badge tone="success">Receiving events</Badge>
      ) : (
        <Badge tone="muted">Waiting for installation</Badge>
      )}
      {install.issues.length ? <Badge tone="warning">Needs attention</Badge> : null}
    </span>
  );
}

function advice(issue: InstallIssue) {
  switch (issue.signal) {
    case "origin_refused":
      return (
        <>
          A page on <code className="font-mono">{issue.origin}</code> tried to load the widget, but
          this environment doesn&apos;t allow that origin. If the site is yours, add it under
          Website origins. Anyone can claim an origin, so only add sites you run.
        </>
      );
    case "secret_refused":
      return (
        <>
          A server request used a secret this environment doesn&apos;t accept. Check that{" "}
          <code className="font-mono">AGENT_ID_SITE_SECRET</code> matches your current secret. If
          the request wasn&apos;t yours, your secret is still safe.
        </>
      );
    case "binding_refused":
      return (
        <>
          The widget on <code className="font-mono">{issue.origin}</code> sent a binding context the
          collector couldn&apos;t verify. Check that your server signs it with this
          environment&apos;s current secret, and that it hasn&apos;t expired.
        </>
      );
  }
}

/** Driven only by what the collector received, so copying a snippet never changes it. */
export function InstallStatusPanel({
  install,
  origins,
}: {
  install: InstallStatus;
  origins: string[];
}) {
  const now = Date.parse(install.checkedAt);
  return (
    <div className="space-y-3 text-sm">
      {install.status === "waiting" ? (
        <>
          <p className="text-muted-foreground">
            Your server hasn&apos;t reported anything yet. It only reports agents, so once it&apos;s
            set up, request a page as a headless browser, then check again. The collector records it
            as one request showing automation, from you. Copying a snippet doesn&apos;t count.
          </p>
          <CopyBlock value={checkCommand(origins[0] ?? "https://your-site.example")} />
        </>
      ) : (
        <ul className="space-y-1">
          {install.lastServerReportAt ? (
            <li>Your server last reported {ago(install.lastServerReportAt, now)}.</li>
          ) : null}
          {install.loaded.map((row) => (
            <li key={row.origin}>
              The widget loaded on <code className="font-mono">{row.origin}</code>{" "}
              {ago(row.lastSeenAt, now)}.
            </li>
          ))}
          {install.loaded.length || install.lastDeclarationAt ? (
            <li className="text-muted-foreground">
              {install.lastDeclarationAt
                ? `Last declaration ${ago(install.lastDeclarationAt, now)}.`
                : "No declarations yet. One arrives when a visitor answers the prompt."}
            </li>
          ) : null}
        </ul>
      )}
      {install.issues.map((issue) => (
        <Notice key={`${issue.signal}:${issue.origin}`} tone="warning">
          {advice(issue)} Last seen {ago(issue.lastSeenAt, now)}.
        </Notice>
      ))}
      <CheckAgain />
    </div>
  );
}
