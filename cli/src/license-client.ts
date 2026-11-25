import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { decodeLicensePayload, verifyLicenseToken, verifyLicenseTokenDetailed } from "../../lib/license";
import type { PlanId } from "../../lib/plans";

export type Tier = "free" | PlanId;

export interface LicenseState {
  tier: Tier;
  status: "none" | "verified" | "offline-grace" | "invalid" | "inactive" | "expired";
  email?: string;
  message?: string;
}

/**
 * Offline grace: after this long without a successful server verification,
 * offline use stops and the CLI fails closed to free. The token's own 30-day
 * expiry is the bound that binds in CI (no state persists there); this file
 * state is the second layer for long-lived machines.
 */
export const OFFLINE_GRACE_SECONDS = 72 * 3600;
const DAY_SECONDS = 24 * 3600;

function allowedIssuer(iss: string): boolean {
  try {
    const u = new URL(iss);
    return u.protocol === "https:" || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname));
  } catch {
    return false;
  }
}

/** Persisted license state: last server-refreshed token + last successful verify. */
interface LicenseCache {
  token?: string;
  sub?: string;
  lastVerifiedAt?: number;
}

function cachePath(): string {
  const base = process.env.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache");
  return join(base, "releaseshield", "license-state.json");
}

function readCache(): LicenseCache {
  try {
    return JSON.parse(readFileSync(cachePath(), "utf8")) as LicenseCache;
  } catch {
    return {};
  }
}

function writeCache(next: LicenseCache): void {
  try {
    const p = cachePath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(next), { mode: 0o600 });
  } catch {
    // Cache is best-effort; a failed write must never break a scan.
  }
}

function graceMessage(ageSeconds: number, graceEndsAt: number): string {
  const ends = new Date(graceEndsAt * 1000).toISOString().slice(0, 16).replace("T", " ");
  if (ageSeconds < DAY_SECONDS) return "Couldn't reach the license server; using your signed license offline.";
  if (ageSeconds < 2 * DAY_SECONDS)
    return `Couldn't reach the license server for over a day; using your signed license offline (grace ends ${ends} UTC).`;
  return `Couldn't reach the license server for over 2 days; using your signed license offline — it stops working ${ends} UTC unless the server is reachable.`;
}

/**
 * 1. Verify the token signature + 30-day expiry offline (Ed25519, public key embedded in this CLI).
 * 2. Ask the issuing server whether the subscription is still active; on success it
 *    re-issues a fresh token, which we persist so a live subscription stays fresh.
 * 3. If the server can't be reached we fail OPEN on the signed plan — but only
 *    within 72h of the last successful verification (or issuance). Past that,
 *    and past the token's own expiry, we fail CLOSED to free: a cancelled
 *    subscription must not keep its paid tier forever in an unreachable room.
 */
export async function resolveLicense(token: string | undefined): Promise<LicenseState> {
  if (!token?.trim()) return { tier: "free", status: "none" };
  const trimmed = token.trim();
  const cache = readCache();
  const now = Math.floor(Date.now() / 1000);

  // Pick the effective token: the configured one when it verifies; a
  // server-refreshed cached one when the configured token has expired
  // (same subscription only — an expired token for another sub never falls back).
  let payload = verifyLicenseToken(trimmed);
  let effectiveToken = trimmed;
  if (!payload) {
    const detail = verifyLicenseTokenDetailed(trimmed);
    if (!detail.ok && detail.reason === "expired") {
      const old = decodeLicensePayload(trimmed);
      const cached = cache.token ? verifyLicenseToken(cache.token) : null;
      if (cached && old && cache.sub === old.sub && cached.sub === old.sub) {
        payload = cached;
        effectiveToken = cache.token as string;
      } else {
        const expDate = old?.exp ? new Date(old.exp * 1000).toISOString().slice(0, 10) : "unknown";
        const base = old?.iss ?? "https://releaseshield.lineanswered.com";
        return {
          tier: "free",
          status: "expired",
          email: old?.email,
          message: `Your ReleaseShield license token expired on ${expDate}. Refresh it at ${base}/#pricing or revisit your checkout success link.`,
        };
      }
    } else {
      return { tier: "free", status: "invalid", message: "RELEASESHIELD_TOKEN is not a valid ReleaseShield license token." };
    }
  }

  const base = (process.env.RELEASESHIELD_API_URL ?? payload.iss).replace(/\/$/, "");

  // Offline grace, bounded: last known-good moment is the last successful
  // verify, falling back to issuance (a token was minted by the server then).
  const offlineGrace = (): LicenseState => {
    const anchor = cache.lastVerifiedAt ?? payload.iat;
    const age = now - anchor;
    const graceEndsAt = anchor + OFFLINE_GRACE_SECONDS;
    if (age > OFFLINE_GRACE_SECONDS) {
      return {
        tier: "free",
        status: "inactive",
        email: payload.email,
        message: `License hasn't been verified for over 72 hours; connect to the license server or refresh your token at ${base}/#pricing.`,
      };
    }
    return { tier: payload.plan, status: "offline-grace", email: payload.email, message: graceMessage(age, graceEndsAt) };
  };

  if (!allowedIssuer(base)) return offlineGrace();

  try {
    const res = await fetch(`${base}/api/license/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "releaseshield-cli" },
      body: JSON.stringify({ token: effectiveToken }),
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return offlineGrace();
    const data = (await res.json()) as { valid?: boolean; plan?: PlanId; reason?: string; status?: string; token?: string };
    if (data.valid) {
      // Persist a server-refreshed token only when it verifies and belongs to
      // the same subscription — never trust a token the server hands us blind.
      let cacheToken = effectiveToken;
      if (typeof data.token === "string") {
        const fresh = verifyLicenseToken(data.token);
        if (fresh && fresh.sub === payload.sub) cacheToken = data.token;
      }
      writeCache({ token: cacheToken, sub: payload.sub, lastVerifiedAt: now });
      return { tier: data.plan === "pro" ? "pro" : "standard", status: "verified", email: payload.email };
    }
    return {
      tier: "free",
      status: "inactive",
      email: payload.email,
      message: `License is no longer active (${data.status ?? data.reason ?? "unknown"}). Renew at ${base}/#pricing`,
    };
  } catch {
    return offlineGrace();
  }
}
