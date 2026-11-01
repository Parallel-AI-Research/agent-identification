import { CopyBlock } from "./copy-block";
import { Notice } from "./ui";

export function SecretOnce({ secret }: { secret: string }) {
  return (
    <div className="space-y-2">
      <Notice tone="warning">
        Copy this server secret now. It is shown once and can&apos;t be retrieved later. Keep it on
        your server only, and never put it in browser code.
      </Notice>
      <CopyBlock value={secret} label="Copy secret" />
    </div>
  );
}
