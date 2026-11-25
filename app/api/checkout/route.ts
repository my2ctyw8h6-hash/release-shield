import { NextResponse } from "next/server";
import { isPlanId } from "@/lib/plans";
import { getPaymentLinkUrl } from "@/lib/stripe";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { configuredSiteUrl } from "@/lib/site";
import { cleanRef } from "@/lib/stats";
import { appendCountedEvent } from "@/lib/counted-events";

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
      // One stable id for this event, shared by the log line and the durable gist
      // store so the counter dedupes the two paths against each other (item 17).
      const eventId = crypto.randomUUID();
      const ref = cleanRef(body.ref);
      console.log(JSON.stringify({ rs_track: 1, id: eventId, src: "server", type: "checkout_started", ref, plan: body.plan, path: "/pricing" }));
      // Durable event store (item 17): awaited-with-catch — a failed write is
      // logged inside appendCountedEvent and never breaks the checkout; the
      // log-window path still counts the event.
      await appendCountedEvent({
        id: eventId,
        type: "checkout_started",
        ref,
        plan: body.plan,
        path: "/pricing",
        src: "server",
        createdAt: new Date().toISOString(),
      });
    }
    return NextResponse.json({ url });
  } catch (err) {
    // Never leak Stripe internals or key details to the client.
    console.error("[checkout] failed to get payment link", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Checkout is temporarily unavailable. Please try again shortly." }, { status: 502 });
  }
}
