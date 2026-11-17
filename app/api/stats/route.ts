import { NextResponse } from "next/server";
import { getStats } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getStats();
  const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
  return NextResponse.json(
    {
      ...s,
      funnel: {
        pageviews: s.totals.pageview,
        scans: s.totals.scan_run,
        checkoutClicks: s.totals.checkout_click,
        scanRatePct: rate(s.totals.scan_run, s.totals.pageview),
        checkoutRatePct: rate(s.totals.checkout_click, s.totals.pageview),
      },
      note: "Aggregate counts only (no cookies, IPs or visitor IDs). Per-instance and best-effort on serverless; resets on cold start.",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
