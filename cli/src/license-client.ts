import { verifyLicenseToken } from "../../lib/license";
import type { PlanId } from "../../lib/plans";

export type Tier = "free" | PlanId;

export interface LicenseState {
  tier: Tier;
  status: "none" | "verified" | "offline-grace" | "invalid" | "inactive";
  email?: string;
  message?: string;
}

function allowedIssuer(iss: string): boolean {
  try {
    const u = new URL(iss);
    return u.protocol === "https:" || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname));
  } catch {
    return false;
  }
}

/**
 * 1. Verify the token signature offline (Ed25519, public key embedded in this CLI).
 * 2. Ask the issuing server whether the subscription is still active.
 *    If the server can't be reached we fail OPEN on the signed plan so customers' CI never breaks
 *    because of our outage.
 */
export async function resolveLicense(token: string | undefined): Promise<LicenseState> {
  if (!token?.trim()) return { tier: "free", status: "none" };
  const payload = verifyLicenseToken(token);
  if (!payload) return { tier: "free", status: "invalid", message: "RELEASESHIELD_TOKEN is not a valid ReleaseShield license token." };

  const base = (process.env.RELEASESHIELD_API_URL ?? payload.iss).replace(/\/$/, "");
  const grace: LicenseState = {
    tier: payload.plan,
    status: "offline-grace",
    email: payload.email,
    message: "Couldn't reach the license server; using your signed license offline.",
  };
  if (!allowedIssuer(base)) return grace;

  try {
    const res = await fetch(`${base}/api/license/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "releaseshield-cli" },
      body: JSON.stringify({ token: token.trim() }),
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return grace;
    const data = (await res.json()) as { valid?: boolean; plan?: PlanId; reason?: string; status?: string };
    if (data.valid) return { tier: data.plan === "pro" ? "pro" : "standard", status: "verified", email: payload.email };
    return {
      tier: "free",
      status: "inactive",
      email: payload.email,
      message: `License is no longer active (${data.status ?? data.reason ?? "unknown"}). Renew at ${base}/#pricing`,
    };
  } catch {
    return grace;
  }
}
