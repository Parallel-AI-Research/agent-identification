import {
  isActionName,
  isOutcome,
  isReference,
  isRoutePattern,
  MAX_PATH,
  routePath,
  type Outcome,
} from "../src/protocol.js";
import { isUuid } from "../src/server/tokens.js";
import { HttpError } from "./http.js";

/** Reports may arrive late, but not from before a day ago or noticeably ahead of the clock. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_AHEAD_MS = 60 * 1000;

function list(value: unknown, field: string, max: number): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) {
    throw new HttpError(400, `${field} must be a list of 1–${max} items`);
  }
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new HttpError(400, `Each of ${field} must be an object`);
    }
  }
  return value as Record<string, unknown>[];
}
function fields(item: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(item).some((key) => !allowed.includes(key))) {
    throw new HttpError(400, "Unexpected event fields");
  }
}
function id(value: unknown): string {
  if (!isUuid(value)) throw new HttpError(400, "Each event needs a UUID id");
  return value.toLowerCase();
}
function time(value: unknown, now: number): string {
  const at = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(at) || at < now - MAX_AGE_MS || at > now + MAX_AHEAD_MS) {
    throw new HttpError(400, "occurredAt must be an ISO time within the last day");
  }
  return new Date(at).toISOString();
}

export interface PageViewInput {
  id: string;
  path: string;
  route: string | null;
  occurredAt: string;
}
/** The collector masks every path itself, so masking never depends on the browser. */
export function pageViewInputs(value: unknown, now: number): PageViewInput[] {
  return list(value, "views", 10).map((item) => {
    fields(item, ["id", "path", "route", "occurredAt"]);
    if (typeof item.path !== "string" || item.path.length > 2048) {
      throw new HttpError(400, "Each view needs a path");
    }
    if (item.route !== undefined && item.route !== null && !isRoutePattern(item.route)) {
      throw new HttpError(400, "route must be a path pattern such as /tickets/:id");
    }
    const path = routePath(item.path);
    return {
      id: id(item.id),
      path: path.length > MAX_PATH ? path.slice(0, MAX_PATH) : path,
      route: (item.route as string | undefined) ?? null,
      occurredAt: time(item.occurredAt, now),
    };
  });
}

export interface ActionInput {
  id: string;
  action: string;
  outcome: Outcome;
  resourceRef: string | null;
  accountRef: string | null;
  /** The host's own session binding, never a session ID a browser could have supplied. */
  sessionBinding: string | null;
  occurredAt: string;
}
export function actionInputs(value: unknown, now: number): ActionInput[] {
  return list(value, "actions", 50).map((item) => {
    fields(item, [
      "id",
      "action",
      "outcome",
      "resourceRef",
      "accountRef",
      "sessionBinding",
      "occurredAt",
    ]);
    if (!isActionName(item.action)) {
      throw new HttpError(400, "action must be a lowercase name such as ticket.update");
    }
    if (!isOutcome(item.outcome)) {
      throw new HttpError(400, "outcome must be attempted, rejected or confirmed");
    }
    for (const field of ["resourceRef", "accountRef"] as const) {
      if (item[field] !== undefined && item[field] !== null && !isReference(item[field])) {
        throw new HttpError(400, `${field} must be an opaque ID, never a name or email address`);
      }
    }
    const binding = item.sessionBinding;
    if (
      binding !== undefined &&
      binding !== null &&
      (typeof binding !== "string" || binding.length < 1 || binding.length > 512)
    ) {
      throw new HttpError(400, "sessionBinding must be your server's own session binding");
    }
    return {
      id: id(item.id),
      action: item.action,
      outcome: item.outcome,
      resourceRef: (item.resourceRef as string | undefined) ?? null,
      accountRef: (item.accountRef as string | undefined) ?? null,
      sessionBinding: (binding as string | undefined) ?? null,
      occurredAt: time(item.occurredAt, now),
    };
  });
}
