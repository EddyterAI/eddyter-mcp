/**
 * Login assertion — the unforgeable proof the Eddyter web app hands to the MCP's
 * /eddyter/callback so the callback can trust *which* license key belongs to the
 * just-authenticated user (instead of reading it from an attacker-visible query
 * param). See http-oauth.ts and oauth/provider.ts for the surrounding OAuth flow.
 *
 * Format: a standard HS256 JWT signed with a secret shared ONLY between the web app
 * and this server (EDDYTER_CALLBACK_SECRET). We implement it with node:crypto so the
 * MCP needs zero extra deps; the web app may mint it with any JWT library (jose,
 * jsonwebtoken, …) as long as alg=HS256 and the same secret + claims are used.
 *
 * THE CONTRACT the web app (www.eddyter.com/oauth/mcp-login) must fulfil:
 *   1. Authenticate the user (existing Supabase session) — NEVER trust a query key.
 *   2. Resolve THAT user's own license key server-side.
 *   3. Sign: { mcp_code, licenseKey, aud: <issuer>, iat, exp } with the shared
 *      secret. Keep exp short (≤120s) — it only has to survive one redirect.
 *   4. Redirect to {callback}?mcp_code=<code>&assertion=<jwt>.
 * The MCP verifies signature + exp + audience + that mcp_code matches the redirect,
 * so a forged, stale, cross-service, or replayed-for-another-code assertion is
 * rejected.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface AssertionClaims {
  /** Must equal the mcp_code on the callback URL — binds the assertion to one pending auth. */
  mcp_code: string;
  /** The authenticated user's Eddyter license key (eddyt_…). */
  licenseKey: string;
  /** Intended audience — this MCP server's issuer URL. */
  aud?: string;
  /** Issued-at / expiry, seconds since epoch (standard JWT claims). */
  iat?: number;
  exp: number;
  [k: string]: unknown;
}

const b64url = (buf: Buffer): string =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromB64url = (s: string): Buffer =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

const sign = (data: string, secret: string): string =>
  b64url(createHmac("sha256", secret).update(data).digest());

/**
 * Mint an assertion. Lives here so the contract is executable and testable; the
 * web app is the real signer in prod but may reuse this if it shares the codebase.
 */
export function signAssertion(
  claims: Omit<AssertionClaims, "iat"> & { iat?: number },
  secret: string,
): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const iat = claims.iat ?? Math.floor(Date.now() / 1000);
  const payload = b64url(Buffer.from(JSON.stringify({ ...claims, iat })));
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${sign(signingInput, secret)}`;
}

/**
 * Verify an assertion and return its claims, or throw. Fails closed on every
 * anomaly (bad shape, wrong alg, bad signature, expired, audience mismatch).
 */
export function verifyAssertion(
  jwt: string,
  opts: { secret: string; audience?: string; nowSeconds?: number },
): AssertionClaims {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("malformed assertion");
  const [header, payload, signature] = parts;

  // Signature first — constant-time compare; reject before parsing untrusted claims.
  const expected = sign(`${header}.${payload}`, opts.secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("invalid assertion signature");
  }

  let head: { alg?: string };
  let claims: AssertionClaims;
  try {
    head = JSON.parse(fromB64url(header).toString("utf8"));
    claims = JSON.parse(fromB64url(payload).toString("utf8"));
  } catch {
    throw new Error("malformed assertion payload");
  }

  if (head.alg !== "HS256") throw new Error("unsupported assertion alg");

  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= now) {
    throw new Error("assertion expired");
  }
  if (opts.audience && claims.aud !== opts.audience) {
    throw new Error("assertion audience mismatch");
  }
  if (typeof claims.mcp_code !== "string" || !claims.mcp_code) {
    throw new Error("assertion missing mcp_code");
  }
  if (typeof claims.licenseKey !== "string" || !claims.licenseKey) {
    throw new Error("assertion missing licenseKey");
  }
  return claims;
}
