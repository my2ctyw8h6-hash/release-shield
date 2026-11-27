import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { cleanRef, isEventType, recordEvent } from "@/lib/stats";
import { appendCountedEvent, DEPLOY_SHA } from "@/lib/counted-events";
import { PLANS } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Crawlers, link previews and uptime monitors are not visitors; counting them inflated pageviews.
const BOT_UA = /bot|crawler|spider|headless|curl|wget|uptime|preview/i;

export async function POST(req: Request) {
  if (BOT_UA.test(req.headers.get("user-agent") ?? "")) return new NextResponse(null, { status: 204 });

  // IP is used only as an in-memory rate-limit key; it is never stored.
  const rl = rateLimit(`track:${clientIp(req)}`, 60, 60_000);
  if (!rl.ok) return new NextResponse(null, { status: 429 });

  // Body may arrive as JSON (fetch) or text/plain (sendBeacon).
  const body = (await req
    .text()
    .then((t) => JSON.parse(t))
    .catch(() => null)) as Record<string, unknown> | null;

  const type = body?.type;
  if (!isEventType(type)) return NextResponse.json({ error: "Unknown event type." }, { status: 400 });

  const ref = cleanRef(body?.ref ?? new URL(req.url).searchParams.get("ref"));
  const plan = typeof body?.plan === "string" && body.plan in PLANS ? body.plan : undefined;

  // location.pathname keeps scoped names encoded (/npm/%40scope/pkg); decode first or the
  // sanitizer drops the "%" and logs /npm/40scope/pkg, which matches no page.
  let rawPath = typeof body?.path === "string" ? body.path : "";
  try {
    rawPath = decodeURIComponent(rawPath);
  } catch {
    /* malformed escape: sanitize as-is */
  }
  const path = rawPath.startsWith("/") ? rawPath.replace(/[^\w@./\-]/g, "").slice(0, 120) : undefined;

  // One stable id for this event, shared by the log line and the durable gist
  // store so the counter dedupes the two paths against each other (item 17).
  const eventId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  // One JSON line per event: the per-instance counters below lose most events on Vercel,
  // so /root/track-cumulative.js counts from these function logs instead (deduped by requestId).
  console.log(JSON.stringify({ rs_track: 1, id: eventId, dep: DEPLOY_SHA, type, ref, plan, path }));

  // Durable event store (item 17): only pageviews are appended here — scan_run
  // and checkout_click beacons are client-side and never counted; the server
  // emits scan_run / checkout_started itself from /api/scan and /api/checkout.
  // P21 (Nov 26, 2026): awaited in the request path, NOT via after() - under
  // burst load the after() callback can be dropped silently when the function
  // freezes (P20 drill lost one pageview with no log line at all, L8). The
  // write never throws and never breaks the request; a failed write is logged
  // inside appendCountedEvent and the log-window path still counts the event.
  if (type === "pageview") {
    await appendCountedEvent({ id: eventId, type, ref, plan, path, createdAt });
  }

  await recordEvent(type, ref, plan);
  return new NextResponse(null, { status: 204 });
}
