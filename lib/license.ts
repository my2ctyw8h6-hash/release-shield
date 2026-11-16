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
  /** issuing server base URL, used for online revocation checks */
  iss: string;
}

export const TOKEN_PREFIX = "rs_";

export function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** Verifies the Ed25519 signature offline. Returns the payload or null. */
export function verifyLicenseToken(token: string, publicKeyPem: string = LICENSE_PUBLIC_KEY_PEM): LicensePayload | null {
  const t = token.trim();
  if (!t.startsWith(TOKEN_PREFIX)) return null;
  const [body, sig] = t.slice(TOKEN_PREFIX.length).split(".");
  if (!body || !sig) return null;
  try {
    const ok = verify(null, Buffer.from(body), createPublicKey(publicKeyPem), Buffer.from(sig, "base64url"));
    if (!ok) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as LicensePayload;
    if (payload.v !== 1 || !payload.sub || (payload.plan !== "standard" && payload.plan !== "pro")) return null;
    return payload;
  } catch {
    return null;
  }
}
