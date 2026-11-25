import { NextResponse } from "next/server";
import { verifyLicenseToken } from "@/lib/license";
import { signLicenseToken } from "@/lib/license-server";
import { getSubscriptionStatus } from "@/lib/stripe";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Called by the CLI / GitHub Action to confirm a license is still active.
 * 200 {valid:true|false}: definitive answer. 503: temporarily unable to check (clients fail open).
 * On a valid subscription the server re-issues a fresh token (30-day window
 * from now), so a live subscription's token never goes stale; the CLI
 * persists the refreshed token for its next run.
 */
export async function POST(req: Request) {
  const rl = rateLimit(`license:${clientIp(req)}`, 60, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const payload = typeof body?.token === "string" ? verifyLicenseToken(body.token) : null;
  if (!payload) return NextResponse.json({ valid: false, reason: "invalid_token" });

  try {
    const status = await getSubscriptionStatus(payload.sub);
    if (!status.active) return NextResponse.json({ valid: false, reason: "subscription_inactive", status: status.status });
    // Live plan wins (handles upgrades/downgrades in the Stripe portal).
    const plan = status.plan ?? payload.plan;
    let fresh: string | undefined;
    try {
      fresh = signLicenseToken({
        v: 1,
        sub: payload.sub,
        cus: payload.cus,
        plan,
        email: payload.email,
        iat: Math.floor(Date.now() / 1000),
        iss: payload.iss,
      });
    } catch {
      // Signing not configured — verify still answers; the CLI keeps its token.
    }
    return NextResponse.json({ valid: true, plan, status: status.status, ...(fresh ? { token: fresh } : {}) });
  } catch (err) {
    const code = (err as { statusCode?: number })?.statusCode;
    if (code === 404) return NextResponse.json({ valid: false, reason: "subscription_not_found" });
    console.error("[license] verify failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "License check temporarily unavailable." }, { status: 503 });
  }
}
