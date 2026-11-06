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
          A page on <code className="font-mono">{issue.origin}</code> tried to report to this
          environment, but it doesn&apos;t allow that origin. If the site is yours, add it under
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
            Nothing has reported yet. Open a page that has the page script, and request one as a
            headless browser to check your server, which only reports agents. The collector records
            that request as automation, from you. Copying a snippet doesn&apos;t count.
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
              Pages on <code className="font-mono">{row.origin}</code> last reported{" "}
              {ago(row.lastSeenAt, now)}.
            </li>
          ))}
          {install.lastServerReportAt ? null : (
            <li className="text-muted-foreground">
              Your server hasn&apos;t reported yet. It only reports agents, so request a page as a
              headless browser to check it.
            </li>
          )}
          {install.loaded.length ? null : (
            <li className="text-muted-foreground">
              No page has reported yet. Open one that has the page script.
            </li>
          )}
          {install.lastDeclarationAt ? (
            <li className="text-muted-foreground">
              Last declaration {ago(install.lastDeclarationAt, now)}.
            </li>
          ) : null}
        </ul>
      )}
      {install.status === "receiving" && !install.lastServerReportAt ? (
        <CopyBlock value={checkCommand(origins[0] ?? "https://your-site.example")} />
      ) : null}
      {install.issues.map((issue) => (
        <Notice key={`${issue.signal}:${issue.origin}`} tone="warning">
          {advice(issue)} Last seen {ago(issue.lastSeenAt, now)}.
        </Notice>
      ))}
      <CheckAgain />
    </div>
  );
}
