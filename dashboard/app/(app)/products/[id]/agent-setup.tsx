import { CopyBlock } from "@/components/copy-block";
import { agentPrompt, type InstallValues } from "@/lib/snippets";

export function AgentSetup({ values, origins }: { values: InstallValues; origins: string[] }) {
  return (
    <details className="mt-5 rounded-md border border-border">
      <summary className="cursor-pointer rounded-md px-3 py-2.5 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        Set this up with your coding agent
      </summary>
      <div className="space-y-3 px-3 pb-3">
        <p className="text-sm text-muted-foreground">
          Paste these instructions into Claude Code, Cursor, Codex or any coding agent that can edit
          your project. They include your public site ID and no secrets.
        </p>
        <CopyBlock value={agentPrompt(values, origins)} label="Copy instructions" wrap />
      </div>
    </details>
  );
}
