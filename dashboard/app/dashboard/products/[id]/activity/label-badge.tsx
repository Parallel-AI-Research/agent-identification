import { Badge } from "@/components/ui";
import type { SessionLabel } from "@/lib/collector";
import { LABELS } from "@/lib/labels";

export function LabelBadge({ label }: { label: SessionLabel }) {
  const tone =
    label === "verified_signer" || label === "declared_ai"
      ? "success"
      : label === "suspected_automation"
        ? "warning"
        : "muted";
  return <Badge tone={tone}>{LABELS[label]}</Badge>;
}
