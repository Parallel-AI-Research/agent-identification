import type { ActivityItem, SessionLabel } from "./collector";

/** Never "human": a session without any signal stays unknown. */
export const LABELS: Record<SessionLabel, string> = {
  verified_signer: "Verified signer",
  declared_ai: "Declared AI",
  suspected_automation: "Suspected automation",
  declared_person: "Declared person",
  unknown: "Unknown",
};

/** Who vouches for an event, in plain words. */
export const EVIDENCE: Record<string, string> = {
  self_reported: "Said by the visitor",
  browser_reported: "Reported by your page",
  host_reported: "Reported by your server",
  signature_verified: "Verified signature",
  signature_claimed: "Signature not verified",
  cdn_reported: "Your CDN's verdict",
};

const CHOICES = {
  ai_assistant: "AI assistant",
  person: "Person",
  prefer_not_to_say: "Prefer not to say",
};

export function describe(event: ActivityItem): string {
  switch (event.type) {
    case "declaration":
      return `Answered ${CHOICES[event.choice!]}`;
    case "page_view":
      return `Viewed ${event.route ?? event.path}`;
    case "action":
      return `${event.action} ${event.outcome}`;
    case "signal":
      return event.signal === "agent_user_agent"
        ? `User agent claims to be ${event.detail ?? "an AI agent"}`
        : event.signal === "webdriver"
          ? "Automated browser (webdriver flag)"
          : "Headless browser";
    case "signature":
      return event.result === "verified"
        ? `Signed by ${event.signer ?? "a verified signer"}${event.path ? ` on ${event.path}` : ""}`
        : `Signature from ${event.signatureAgent ?? "an unknown signer"} not verified (${event.result?.replaceAll("_", " ")})`;
  }
}
