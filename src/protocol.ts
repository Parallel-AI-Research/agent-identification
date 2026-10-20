/** Shared wire protocol. Classifications are always self-reported. */
export const VERSION = "0.1.0";
export const CHOICES = ["ai_assistant", "person", "prefer_not_to_say"] as const;
export type Choice = (typeof CHOICES)[number];
export type Mode = "optional" | "required";
export interface SessionStatus {
  sessionId: string;
  siteId: string;
  origin: string;
  expiresAt: string;
  choice: Choice | null;
  receipt: string | null;
  eventId: string | null;
  evidence: "self_reported";
}
export interface CreatedSession extends SessionStatus {
  sessionToken: string;
}
export interface RecordedDeclaration extends SessionStatus {
  choice: Choice;
  receipt: string;
  eventId: string;
}
export interface ApiError {
  error: string;
}
export function isChoice(value: unknown): value is Choice {
  return typeof value === "string" && (CHOICES as readonly string[]).includes(value);
}
