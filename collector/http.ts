export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const MAX_BODY = 8192;

export function bearer(request: Request): string {
  const value = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([^\s]{1,2048})$/i.exec(value);
  if (!match) throw new HttpError(401, "Authentication required");
  return match[1]!;
}
export async function body(
  request: Request,
  allowedKeys: string[],
): Promise<Record<string, unknown>> {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
  ) {
    throw new HttpError(415, "Content-Type must be application/json");
  }
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) {
    throw new HttpError(413, "Request body too large");
  }
  if (!request.body) throw new HttpError(400, "A JSON object is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        throw new HttpError(413, "Request body too large");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "A valid JSON object is required");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).some((key) => !allowedKeys.includes(key))
  ) {
    throw new HttpError(400, "Unexpected request fields");
  }
  return parsed as Record<string, unknown>;
}
export function eventLimit(url: URL): number {
  const value = url.searchParams.get("limit") ?? "100";
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 1000) {
    throw new HttpError(400, "Limit must be 1–1000");
  }
  return Number(value);
}
