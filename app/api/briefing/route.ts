import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getStats } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CHANGES = 10;
const MAX_STR = 280;

/** Strip anything that looks like a secret or a server path before it leaves the box. */
function scrub(v: unknown): string | null {
  if (v == null) return null;
  return String(v)
    .replace(/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/\bwhsec_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g, "https://[redacted]@")
    .replace(/(?:\/(?:root|home|usr|var|etc|opt|tmp)\b)[^\s"'`)]*/g, "[path]")
    .slice(0, MAX_STR);
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(/[$,]/g, "")) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

type Status = Record<string, unknown>;

async function readStudioStatus(): Promise<Status | null> {
  try {
    const raw = await readFile(path.join(process.cwd(), "public", "studio-status.json"), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function pick(s: Status, ...keys: string[]): unknown {
  for (const k of keys) if (s[k] !== undefined) return s[k];
  return undefined;
}

/** Whitelist only the fields we intend to expose; everything else in the file is ignored. */
function summarise(s: Status | null) {
  if (!s) return { revenueSummary: null, recentChanges: [] as unknown[] };

  const revenueSummary = {
    mrrUsd: num(pick(s, "mrr", "mrrUsd", "revenue", "latestRevenue")),
    activeSubscribers: num(pick(s, "subscribers", "subscriberCount", "activeSubscribers")),
    updatedAt: scrub(pick(s, "updatedAt", "lastUpdated", "timestamp")),
  };

  const entries = pick(s, "recentChanges", "evolutionLog", "recentEvolution", "changes");
  const recentChanges = (Array.isArray(entries) ? entries : []).slice(0, MAX_CHANGES).map((e) =>
    e && typeof e === "object"
      ? {
          date: scrub(pick(e as Status, "date", "time", "timestamp")),
          summary: scrub(pick(e as Status, "summary", "title", "message", "change")),
        }
      : { date: null, summary: scrub(e) },
  );

  return { revenueSummary, recentChanges };
}

/** Public, read-only. Output is whitelisted + scrubbed: no keys, secrets, or server paths. */
export async function GET() {
  const noStore = { "cache-control": "no-store" };

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
      ...summarise(status),
    },
    { headers: noStore },
  );
}
