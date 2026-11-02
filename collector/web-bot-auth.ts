import { createHash, createPublicKey, constants, verify } from "node:crypto";
import type { SignatureResult } from "../src/protocol.js";

/*
 * Web Bot Auth (draft-ietf-webbotauth-httpsig-protocol-01): an agent signs each request with
 * HTTP Message Signatures (RFC 9421) and names its key directory in Signature-Agent. This
 * checks such a signature against the published key of an allowlisted signer.
 */

/** Signers whose key directories the collector trusts, keyed by the Signature-Agent URL. */
export interface Signer {
  agent: string;
  name: string;
}
/**
 * Listed only where the operator publishes its Signature-Agent value. Being listed doesn't make
 * a signer supported: that needs a real signed request verified on the hosted collector.
 */
export const DEFAULT_SIGNERS: Signer[] = [{ agent: "https://chatgpt.com", name: "ChatGPT agent" }];
export const MAX_SIGNATURE_LIFETIME_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;

type Bare = string | number | boolean | Uint8Array | { token: string };
type Params = [string, Bare][];
interface Item {
  value: Bare;
  params: Params;
}
interface InnerList {
  items: Item[];
  params: Params;
}
type Member = Item | InnerList;

class Malformed extends Error {}

/** Just enough of RFC 8941 structured fields for Web Bot Auth's three headers. */
class Parser {
  private index = 0;
  constructor(private text: string) {}
  private peek(): string | undefined {
    return this.text[this.index];
  }
  private spaces(): void {
    while (this.peek() === " ") this.index++;
  }
  private ows(): void {
    while (this.peek() === " " || this.peek() === "\t") this.index++;
  }
  private expect(character: string): void {
    if (this.peek() !== character) throw new Malformed(`Expected ${character}`);
    this.index++;
  }
  private key(): string {
    const match = /^[a-z*][a-z0-9_.*-]*/.exec(this.text.slice(this.index));
    if (!match) throw new Malformed("Expected a key");
    this.index += match[0].length;
    return match[0];
  }
  private bare(): Bare {
    const character = this.peek();
    if (character === '"') {
      this.index++;
      let value = "";
      for (;;) {
        const next = this.text[this.index++];
        if (next === undefined) throw new Malformed("Unterminated string");
        if (next === '"') return value;
        if (next === "\\") {
          const escaped = this.text[this.index++];
          if (escaped !== '"' && escaped !== "\\") throw new Malformed("Bad escape");
          value += escaped;
        } else if (next < " " || next > "~") {
          throw new Malformed("Bad string character");
        } else {
          value += next;
        }
      }
    }
    if (character === ":") {
      this.index++;
      const end = this.text.indexOf(":", this.index);
      if (end < 0) throw new Malformed("Unterminated byte sequence");
      const encoded = this.text.slice(this.index, end);
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Malformed("Bad byte sequence");
      this.index = end + 1;
      return new Uint8Array(Buffer.from(encoded, "base64"));
    }
    if (character === "?") {
      this.index++;
      const flag = this.text[this.index++];
      if (flag !== "0" && flag !== "1") throw new Malformed("Bad boolean");
      return flag === "1";
    }
    const number = /^-?\d{1,15}(?!\.)/.exec(this.text.slice(this.index));
    if (number) {
      this.index += number[0].length;
      return Number(number[0]);
    }
    const token = /^[A-Za-z*][A-Za-z0-9!#$%&'*+.^_`|~:/-]*/.exec(this.text.slice(this.index));
    if (token) {
      this.index += token[0].length;
      return { token: token[0] };
    }
    throw new Malformed("Expected a value");
  }
  private params(): Params {
    const params: Params = [];
    while (this.peek() === ";") {
      this.index++;
      this.spaces();
      const key = this.key();
      let value: Bare = true;
      if (this.peek() === "=") {
        this.index++;
        value = this.bare();
      }
      params.push([key, value]);
    }
    return params;
  }
  private item(): Item {
    return { value: this.bare(), params: this.params() };
  }
  private member(): Member {
    if (this.peek() !== "(") return this.item();
    this.index++;
    const items: Item[] = [];
    for (;;) {
      this.spaces();
      if (this.peek() === ")") {
        this.index++;
        return { items, params: this.params() };
      }
      items.push(this.item());
      const next = this.peek();
      if (next !== " " && next !== ")") throw new Malformed("Bad inner list");
    }
  }
  private done(): void {
    this.ows();
    if (this.index !== this.text.length) throw new Malformed("Unexpected trailing text");
  }
  dictionary(): Map<string, Member> {
    const members = new Map<string, Member>();
    this.spaces();
    while (this.index < this.text.length) {
      const key = this.key();
      let member: Member;
      if (this.peek() === "=") {
        this.index++;
        member = this.member();
      } else {
        member = { value: true, params: this.params() };
      }
      members.set(key, member);
      this.ows();
      if (this.index >= this.text.length) break;
      this.expect(",");
      this.ows();
      if (this.index >= this.text.length) throw new Malformed("Trailing comma");
    }
    return members;
  }
  /** A lone item, as the legacy Signature-Agent: "https://..." form sends. */
  single(): Item {
    this.spaces();
    const item = this.item();
    this.done();
    return item;
  }
}

function serializeBare(value: Bare): string {
  if (typeof value === "string") return `"${value.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "?1" : "?0";
  if (value instanceof Uint8Array) return `:${Buffer.from(value).toString("base64")}:`;
  return value.token;
}
function serializeParams(params: Params): string {
  return params
    .map(([key, value]) => (value === true ? `;${key}` : `;${key}=${serializeBare(value)}`))
    .join("");
}
function serializeItem(item: Item): string {
  return serializeBare(item.value) + serializeParams(item.params);
}
function isInnerList(member: Member): member is InnerList {
  return "items" in member;
}
const param = (params: Params, key: string) => params.find(([name]) => name === key)?.[1];

export interface SignedRequest {
  method: string;
  url: URL;
  /** Lowercase header names. */
  headers: Record<string, string>;
}
export interface Verification {
  result: SignatureResult;
  signer: string | null;
  signatureAgent: string | null;
  /** When the signature says it was made, so a retried report matches the original. */
  createdAt: number | null;
  /** The signature's own bytes, which identify a replay. */
  signature: Uint8Array | null;
}
export interface VerifyOptions {
  now: number;
  /** The longest validity window accepted. The draft recommends no more than a day. */
  maxLifetimeMs?: number;
  /** The hostnames, with any port, of the origins this site allows. */
  authorities: string[];
  signers: Signer[];
  keys: KeyDirectory;
}

/** The key directory a Signature-Agent value points to: its well-known path, or the URL itself. */
export function directoryUrl(agent: URL): string {
  return agent.pathname === "/"
    ? `${agent.origin}/.well-known/http-message-signatures-directory`
    : `${agent.origin}${agent.pathname}`;
}
/** The agent's identifier: its URL without a query or fragment (draft section 5.5). */
function agentIdentifier(agent: URL): string {
  return agent.pathname === "/" ? agent.origin : `${agent.origin}${agent.pathname}`;
}
/** RFC 7638 and RFC 8037 thumbprints, which Web Bot Auth key IDs must be. */
export function thumbprint(jwk: JsonWebKey): string | null {
  let members: Record<string, unknown>;
  if (jwk.kty === "OKP" && jwk.crv === "Ed25519" && typeof jwk.x === "string") {
    members = { crv: jwk.crv, kty: jwk.kty, x: jwk.x };
  } else if (jwk.kty === "RSA" && typeof jwk.n === "string" && typeof jwk.e === "string") {
    members = { e: jwk.e, kty: jwk.kty, n: jwk.n };
  } else {
    return null;
  }
  return createHash("sha256").update(JSON.stringify(members)).digest("base64url");
}

function componentValue(item: Item, request: SignedRequest): string {
  if (typeof item.value !== "string") throw new Malformed("Component names are strings");
  const name = item.value;
  const { url } = request;
  if (name.startsWith("@")) {
    if (item.params.length) throw new Malformed("Unsupported derived component parameter");
    switch (name) {
      case "@authority":
        return url.host.toLowerCase();
      case "@method":
        return request.method.toUpperCase();
      case "@path":
        return url.pathname || "/";
      case "@query":
        return url.search || "?";
      case "@scheme":
        return url.protocol.slice(0, -1);
      case "@target-uri":
        return url.href;
      default:
        throw new Malformed(`Unsupported component ${name}`);
    }
  }
  const raw = request.headers[name];
  if (raw === undefined) throw new Malformed(`Missing covered header ${name}`);
  const key = param(item.params, "key");
  if (item.params.length === 0) return raw.trim();
  if (item.params.length !== 1 || typeof key !== "string") {
    throw new Malformed("Unsupported field parameter");
  }
  const member = new Parser(raw).dictionary().get(key);
  if (!member || isInnerList(member)) throw new Malformed(`Missing dictionary member ${key}`);
  return serializeItem(member);
}

export async function verifySignedRequest(
  request: SignedRequest,
  options: VerifyOptions,
): Promise<Verification> {
  const outcome = (result: SignatureResult, extra: Partial<Verification> = {}): Verification => ({
    result,
    signer: null,
    signatureAgent: null,
    createdAt: null,
    signature: null,
    ...extra,
  });
  let label: string;
  let input: InnerList;
  let signature: Uint8Array;
  let agent: URL;
  try {
    const inputs = new Parser(request.headers["signature-input"] ?? "").dictionary();
    const found = [...inputs].find(
      ([, member]) => isInnerList(member) && param(member.params, "tag") === "web-bot-auth",
    );
    if (!found) throw new Malformed("No web-bot-auth signature");
    [label] = found;
    input = found[1] as InnerList;
    const signed = new Parser(request.headers["signature"] ?? "").dictionary().get(label);
    if (!signed || isInnerList(signed) || !(signed.value instanceof Uint8Array)) {
      throw new Malformed("No signature for the label");
    }
    signature = signed.value;
    // Signers send a dictionary keyed by label; the older single-string form is still accepted.
    const header = request.headers["signature-agent"] ?? "";
    let named: Item | undefined;
    let legacy = false;
    try {
      const member = new Parser(header).dictionary().get(label);
      if (member && !isInnerList(member)) named = member;
    } catch {
      // Not a dictionary, so try the single-string form.
    }
    if (!named) {
      named = new Parser(header).single();
      legacy = true;
    }
    if (typeof named.value !== "string" || named.params.length) {
      throw new Malformed("Signature-Agent must be a URL string");
    }
    agent = new URL(named.value);
    if (agent.protocol !== "https:" && agent.hostname !== "127.0.0.1") {
      throw new Malformed("Signature-Agent must use HTTPS");
    }
    const covers = (name: string, key?: string) =>
      input.items.some(
        (item) =>
          item.value === name &&
          (key === undefined
            ? item.params.length === 0
            : item.params.length === 1 && param(item.params, "key") === key),
      );
    if (!covers("@authority") && !covers("@target-uri")) {
      throw new Malformed("The signature must cover the authority");
    }
    if (!covers("signature-agent", legacy ? undefined : label)) {
      throw new Malformed("The signature must cover Signature-Agent");
    }
  } catch (error) {
    if (error instanceof Malformed || error instanceof TypeError) return outcome("malformed");
    throw error;
  }

  const signatureAgent = agentIdentifier(agent);
  const created = param(input.params, "created");
  const expires = param(input.params, "expires");
  const keyid = param(input.params, "keyid");
  const alg = param(input.params, "alg");
  if (typeof created !== "number" || typeof expires !== "number" || typeof keyid !== "string") {
    return outcome("malformed", { signatureAgent });
  }
  const createdAt = created * 1000;
  const base = { signatureAgent, createdAt, signature };
  if (!options.authorities.includes(request.url.host.toLowerCase())) {
    return outcome("wrong_authority", base);
  }
  if (
    expires * 1000 <= options.now ||
    createdAt > options.now + CLOCK_SKEW_MS ||
    expires * 1000 - createdAt > (options.maxLifetimeMs ?? MAX_SIGNATURE_LIFETIME_MS)
  ) {
    return outcome("expired", base);
  }
  const signer = options.signers.find((entry) => entry.agent === signatureAgent);
  if (!signer) return outcome("unknown_signer", base);
  const url = directoryUrl(agent);
  let keys = await options.keys.get(url);
  // A key ID the cache doesn't know may be a key the signer has just rotated in.
  if (keys && !keys.some((key) => thumbprint(key) === keyid)) {
    keys = await options.keys.get(url, { refresh: true });
  }
  if (!keys) return outcome("key_unavailable", { ...base, signer: signer.name });
  const jwk = keys.find((key) => thumbprint(key) === keyid);
  if (!jwk) return outcome("bad_signature", { ...base, signer: signer.name });

  let lines: string[];
  try {
    lines = input.items.map((item) => `${serializeItem(item)}: ${componentValue(item, request)}`);
  } catch (error) {
    if (error instanceof Malformed) return outcome("malformed", base);
    throw error;
  }
  const params = `(${input.items.map(serializeItem).join(" ")})${serializeParams(input.params)}`;
  const message = Buffer.from([...lines, `"@signature-params": ${params}`].join("\n"));
  let valid = false;
  try {
    const key = createPublicKey({ key: jwk, format: "jwk" });
    if (jwk.kty === "OKP" && (alg === undefined || alg === "ed25519")) {
      valid = verify(null, message, key, signature);
    } else if (jwk.kty === "RSA" && (alg === undefined || alg === "rsa-pss-sha512")) {
      valid = verify(
        "sha512",
        message,
        { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 64 },
        signature,
      );
    }
  } catch {
    valid = false;
  }
  return valid
    ? outcome("verified", { ...base, signer: signer.name })
    : outcome("bad_signature", { ...base, signer: signer.name });
}

const DIRECTORY_TYPES = [
  "application/http-message-signatures-directory+json",
  "application/jwk-set+json",
  "application/json",
];
const MAX_DIRECTORY_BYTES = 64 * 1024;
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const REFRESH_MS = 10 * 1000;

/**
 * Fetches and caches signers' published keys. It follows the draft: HTTPS only, no redirects,
 * HTTP caching capped at a day, failures retried after five minutes, and a failed refresh never
 * drops keys it already holds.
 */
export class KeyDirectory {
  private cache = new Map<
    string,
    { keys: JsonWebKey[] | null; freshUntil: number; fetchedAt: number }
  >();
  constructor(
    private fetcher: typeof fetch = fetch,
    private clock: () => number = Date.now,
  ) {}
  /**
   * `refresh` fetches again before the cache expires, as when a key ID is new, but at most once
   * every 10 seconds per directory, so unknown key IDs can't turn into a flood of fetches.
   */
  async get(url: string, options: { refresh?: boolean } = {}): Promise<JsonWebKey[] | null> {
    const now = this.clock();
    const cached = this.cache.get(url);
    const fresh = cached && cached.freshUntil > now;
    if (fresh && (!options.refresh || cached.fetchedAt > now - REFRESH_MS)) {
      return usable(cached.keys, now);
    }
    let keys: JsonWebKey[] | null = null;
    let ttl = RETRY_MS;
    try {
      const response = await this.fetcher(url, {
        redirect: "manual",
        headers: { accept: DIRECTORY_TYPES[0]! },
        signal: AbortSignal.timeout(3000),
      });
      const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      const length = Number(response.headers.get("content-length") ?? 0);
      if (
        response.status === 200 &&
        DIRECTORY_TYPES.includes(type ?? "") &&
        length <= MAX_DIRECTORY_BYTES
      ) {
        const text = await response.text();
        if (text.length <= MAX_DIRECTORY_BYTES) {
          const parsed = JSON.parse(text) as { keys?: unknown };
          if (Array.isArray(parsed.keys)) {
            keys = parsed.keys.filter(
              (key): key is JsonWebKey =>
                !!key && typeof key === "object" && thumbprint(key as JsonWebKey) !== null,
            );
            const age = /(?:^|,)\s*max-age=(\d+)/i.exec(
              response.headers.get("cache-control") ?? "",
            );
            ttl = Math.min(
              Math.max(age ? Number(age[1]) * 1000 : DEFAULT_TTL_MS, 60_000),
              86_400_000,
            );
          }
        }
      }
    } catch {
      keys = null;
    }
    if (this.cache.size >= 1000) this.cache.clear();
    if (!keys && cached?.keys) {
      this.cache.set(url, { keys: cached.keys, freshUntil: now + RETRY_MS, fetchedAt: now });
      return usable(cached.keys, now);
    }
    this.cache.set(url, { keys, freshUntil: now + ttl, fetchedAt: now });
    return usable(keys, now);
  }
}
/** Keys outside their own nbf and exp times, when a directory gives them, are left out. */
function usable(keys: JsonWebKey[] | null, now: number): JsonWebKey[] | null {
  if (!keys) return null;
  const seconds = now / 1000;
  return keys.filter((key) => {
    const { nbf, exp } = key as { nbf?: unknown; exp?: unknown };
    return (
      !(typeof nbf === "number" && nbf > seconds) && !(typeof exp === "number" && exp <= seconds)
    );
  });
}

/** One ID per signature, so a retried report is a duplicate and a reused signature conflicts. */
export function signatureEventId(siteId: string, signature: Uint8Array): string {
  const hash = createHash("sha256").update(siteId).update("\0").update(signature).digest("hex");
  // Shaped as a version 8 UUID, which RFC 9562 reserves for custom IDs like this one.
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-${((parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16)}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
