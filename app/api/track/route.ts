import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { cleanRef, isEventType, recordEvent } from "@/lib/stats";
import { PLANS } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
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

  const rawPath = typeof body?.path === "string" ? body.path : "";
  const path = rawPath.startsWith("/") ? rawPath.replace(/[^\w@./\-]/g, "").slice(0, 120) : undefined;

  // One JSON line per event: the per-instance counters below lose most events on Vercel,
  // so /root/track-cumulative.js counts from these function logs instead (deduped by requestId).
  console.log(JSON.stringify({ rs_track: 1, type, ref, plan, path }));

  await recordEvent(type, ref, plan);
  return new NextResponse(null, { status: 204 });
}
