import type { ActivityEvent, AgentClaim, Choice, Outcome } from "../src/protocol.js";

/**
 * One label per session, from the strongest evidence it has, with no score. A cryptographic
 * signature outranks what a visitor says, a self-declared agent outranks heuristics, and
 * heuristics outrank a Person answer, which never erases them. Nothing is ever labelled human.
 */
export const SESSION_LABELS = [
  "verified_signer",
  "declared_ai",
  "suspected_automation",
  "declared_person",
  "unknown",
] as const;
export type SessionLabel = (typeof SESSION_LABELS)[number];

export interface SessionSummary {
  sessionId: string;
  origin: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  label: SessionLabel;
  /** Signals that point different ways. They're shown, never resolved. */
  conflicts: string[];
  pageViews: number;
  actions: Record<Outcome, number>;
  declaration: { choice: Choice; agent: AgentClaim } | null;
  verifiedSigners: string[];
  unverifiedSignatures: number;
  automationSignals: string[];
}
export interface Overview {
  sessions: number;
  labels: Record<SessionLabel, number>;
  /** Page loads the widget reported. */
  pageViews: number;
  /** Requests your server reported with a signature, by how they were checked. */
  signedRequests: { verified: number; unverified: number };
  actions: Record<Outcome, number>;
  declarations: Record<Choice, number>;
  /** Heuristic automation signals, from the page or your server. */
  signals: number;
  /** Events your server reported without a session it could link them to. */
  withoutSession: { actions: number; signedRequests: number; signals: number };
}

const outcomes = (): Record<Outcome, number> => ({ attempted: 0, rejected: 0, confirmed: 0 });

/** Counts come straight from the events, which are unique per ID, so retries never add to them. */
export function summarize(events: ActivityEvent[]): {
  overview: Overview;
  sessions: SessionSummary[];
} {
  const overview: Overview = {
    sessions: 0,
    labels: Object.fromEntries(SESSION_LABELS.map((label) => [label, 0])) as Overview["labels"],
    pageViews: 0,
    signedRequests: { verified: 0, unverified: 0 },
    actions: outcomes(),
    declarations: { ai_assistant: 0, person: 0, prefer_not_to_say: 0 },
    signals: 0,
    withoutSession: { actions: 0, signedRequests: 0, signals: 0 },
  };
  const sessions = new Map<string, SessionSummary>();
  for (const event of events) {
    if (event.type === "page_view") overview.pageViews++;
    if (event.type === "action") overview.actions[event.outcome]++;
    if (event.type === "declaration") overview.declarations[event.choice]++;
    if (event.type === "signal") overview.signals++;
    const verified = event.type === "signature" && event.evidence !== "signature_claimed";
    if (event.type === "signature") {
      overview.signedRequests[verified ? "verified" : "unverified"]++;
    }
    if (!event.sessionId) {
      if (event.type === "action") overview.withoutSession.actions++;
      if (event.type === "signature") overview.withoutSession.signedRequests++;
      if (event.type === "signal") overview.withoutSession.signals++;
      continue;
    }
    let session = sessions.get(event.sessionId);
    if (!session) {
      session = {
        sessionId: event.sessionId,
        origin: event.origin,
        firstSeenAt: event.occurredAt,
        lastSeenAt: event.occurredAt,
        label: "unknown",
        conflicts: [],
        pageViews: 0,
        actions: outcomes(),
        declaration: null,
        verifiedSigners: [],
        unverifiedSignatures: 0,
        automationSignals: [],
      };
      sessions.set(event.sessionId, session);
    }
    session.origin ??= event.origin;
    if (event.occurredAt < session.firstSeenAt) session.firstSeenAt = event.occurredAt;
    if (event.occurredAt > session.lastSeenAt) session.lastSeenAt = event.occurredAt;
    switch (event.type) {
      case "page_view":
        session.pageViews++;
        break;
      case "action":
        session.actions[event.outcome]++;
        break;
      case "declaration":
        session.declaration = { choice: event.choice, agent: event.agent };
        break;
      case "signature":
        if (verified && event.signer && !session.verifiedSigners.includes(event.signer)) {
          session.verifiedSigners.push(event.signer);
        }
        if (!verified) session.unverifiedSignatures++;
        break;
      case "signal": {
        const found = event.detail ? `${event.signal}: ${event.detail}` : event.signal;
        if (!session.automationSignals.includes(found)) session.automationSignals.push(found);
        break;
      }
    }
  }
  const list = [...sessions.values()];
  for (const session of list) {
    const choice = session.declaration?.choice;
    session.label = session.verifiedSigners.length
      ? "verified_signer"
      : choice === "ai_assistant"
        ? "declared_ai"
        : session.automationSignals.length
          ? "suspected_automation"
          : choice === "person"
            ? "declared_person"
            : "unknown";
    if (choice === "person" && session.verifiedSigners.length) {
      session.conflicts.push(
        "Answered Person, but requests in this session carried a verified agent signature.",
      );
    }
    if (choice === "person" && session.automationSignals.length) {
      session.conflicts.push("Answered Person, but the session shows automation signals.");
    }
    if (session.verifiedSigners.length > 1) {
      session.conflicts.push("Signatures from more than one signer.");
    }
    overview.labels[session.label]++;
  }
  overview.sessions = list.length;
  list.sort(
    (a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt) || b.sessionId.localeCompare(a.sessionId),
  );
  return { overview, sessions: list };
}
