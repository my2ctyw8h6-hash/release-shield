import { createPublicKey, verify } from "node:crypto";
import { LICENSE_PUBLIC_KEY_PEM } from "./license-public-key";
import type { PlanId } from "./plans";

export interface LicensePayload {
  v: 1;
  /** Stripe subscription ID */
  sub: string;
  /** Stripe customer ID */
  cus?: string;
  plan: PlanId;
  email?: string;
  /** issued-at (unix seconds) */
  iat: number;
  /**
   * Expiry (unix seconds, iat + 30 days). Tokens minted before the bound
   * carry no exp and are rejected at verify time — with zero live
   * subscribers at the bound's introduction there is nothing to migrate.
   */
  exp?: number;
  /** issuing server base URL, used for online revocation checks */
  iss: string;
}

export const TOKEN_PREFIX = "rs_";

/**
 * License validity window. A token is good for 30 days from issuance.
 * The server re-issues on every successful online verify, so a live
 * subscription stays fresh; a cancelled subscription or a leaked token
 * stops working 30 days after its last server contact at the latest.
 * This is the bound that binds in CI, where no verification state persists.
 */
export const LICENSE_TTL_SECONDS = 30 * 24 * 3600;

export function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export type TokenProblem = "invalid" | "expired";

/**
 * Verifies the Ed25519 signature offline and the expiry bound.
 * Returns the payload, or null when the token is invalid or expired.
 * Use verifyLicenseTokenDetailed when the caller needs to tell the two apart.
 */
export function verifyLicenseToken(token: string, publicKeyPem: string = LICENSE_PUBLIC_KEY_PEM): LicensePayload | null {
  const r = verifyLicenseTokenDetailed(token, publicKeyPem);
  return r.ok ? r.payload : null;
}

export function verifyLicenseTokenDetailed(
  token: string,
  publicKeyPem: string = LICENSE_PUBLIC_KEY_PEM,
): { ok: true; payload: LicensePayload } | { ok: false; reason: TokenProblem } {
  const t = token.trim();
  if (!t.startsWith(TOKEN_PREFIX)) return { ok: false, reason: "invalid" };
  const [body, sig] = t.slice(TOKEN_PREFIX.length).split(".");
  if (!body || !sig) return { ok: false, reason: "invalid" };
  try {
    const ok = verify(null, Buffer.from(body), createPublicKey(publicKeyPem), Buffer.from(sig, "base64url"));
    if (!ok) return { ok: false, reason: "invalid" };
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as LicensePayload;
    if (payload.v !== 1 || !payload.sub || (payload.plan !== "standard" && payload.plan !== "pro")) return { ok: false, reason: "invalid" };
    if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return { ok: false, reason: "expired" };
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/**
 * Decodes a token's payload WITHOUT checking its signature. Untrusted: for
 * messaging and same-subscription comparison only, never for authorization.
 */
export function decodeLicensePayload(token: string): LicensePayload | null {
  try {
    const t = token.trim();
    if (!t.startsWith(TOKEN_PREFIX)) return null;
    const [body] = t.slice(TOKEN_PREFIX.length).split(".");
    if (!body) return null;
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as LicensePayload;
  } catch {
    return null;
  }
}
