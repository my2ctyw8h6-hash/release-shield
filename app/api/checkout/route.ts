import { NextResponse } from "next/server";
import { isPlanId } from "@/lib/plans";
import { getPaymentLinkUrl } from "@/lib/stripe";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { configuredSiteUrl } from "@/lib/site";
import { cleanRef } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function siteUrl(req: Request): string | null {
  const configured = configuredSiteUrl();
  if (configured) return configured;
  try {
    return new URL(req.url).origin;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const rl = rateLimit(`checkout:${clientIp(req)}`, 10, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { plan?: unknown; ref?: unknown } | null;
  if (!isPlanId(body?.plan)) return NextResponse.json({ error: "Unknown plan." }, { status: 400 });

  try {
    const url = await getPaymentLinkUrl(body.plan, siteUrl(req));
    // Server-witnessed checkout start: validated plan, rate-limited, owner-excluded.
    if (!(req.headers.get("cookie") ?? "").includes("rs_owner=1")) {
      console.log(JSON.stringify({ rs_track: 1, src: "server", type: "checkout_started", ref: cleanRef(body.ref), plan: body.plan, path: "/pricing" }));
    }
    return NextResponse.json({ url });
  } catch (err) {
    // Never leak Stripe internals or key details to the client.
    console.error("[checkout] failed to get payment link", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Checkout is temporarily unavailable. Please try again shortly." }, { status: 502 });
  }
}
