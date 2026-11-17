import { NextResponse, type NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { getStats } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_FIELDS = [
  "updatedAt",
  "revenue",
  "recentCodeCommits",
  "evolutionLog",
  "recentSocialPostsAndReplies",
  "latestIdeasAndLeads",
] as const;

/** Strip anything that looks like a secret or a server path before it leaves the box. */
function scrubStr(v: string): string {
  return v
    .replace(/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/\bwhsec_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g, "https://[redacted]@")
    .replace(/(?:\/(?:root|home|usr|var|etc|opt|tmp)\b)[^\s"'`)]*/g, "[path]");
}

function scrub(v: unknown): unknown {
  if (typeof v === "string") return scrubStr(v);
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]));
  }
  return v;
}

/**
 * Key comes from env only. The repo is public, so a hardcoded key is no key.
 * Unset env => endpoint is closed.
 */
function keyMatches(given: string | null): boolean {
  const expected = process.env.MUSE_BRIEFING_KEY;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Status = Record<string, unknown>;

async function readStudioStatus(): Promise<Status | null> {
  try {
    const raw = await readFile(path.join(process.cwd(), "data", "studio-status.json"), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function studio(s: Status | null) {
  return Object.fromEntries(STATUS_FIELDS.map((k) => [k, s ? scrub(s[k] ?? null) : null]));
}

/** Key-gated, read-only. Studio fields are scrubbed of secrets and server paths. */
export async function GET(req: NextRequest) {
  if (!keyMatches(req.nextUrl.searchParams.get("key"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const [s, status] = await Promise.all([getStats(), readStudioStatus()]);
  const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

  return NextResponse.json(
    {
      timestamp: new Date().toISOString(),
      product: "ReleaseShield - Line Answered LLC",
      funnelStats: {
        since: s.since,
        updatedAt: s.updatedAt,
        pageviews: s.totals.pageview,
        scans: s.totals.scan_run,
        checkoutClicks: s.totals.checkout_click,
        scanRatePct: rate(s.totals.scan_run, s.totals.pageview),
        checkoutRatePct: rate(s.totals.checkout_click, s.totals.pageview),
        checkoutByPlan: s.checkoutByPlan,
        note: "Per-instance, best-effort; resets on cold start.",
      },
      ...studio(status),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
