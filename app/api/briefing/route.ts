import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

function keyMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Redact /root/ paths and known secret token prefixes from a JSON string. */
function scrub(json: string): string {
  return json
    .replace(/\/root\/[^\s"'\\,]*/g, "[redacted-path]")
    .replace(/(?:sk-ant-|rk_live_|ghp_)[A-Za-z0-9_-]+/g, "[redacted-token]");
}

/** Key-gated, scrubbed passthrough of the live studio-status JSON. */
export async function GET(req: NextRequest) {
  if (!keyMatches(req.nextUrl.searchParams.get("key"), process.env.MUSE_BRIEFING_KEY)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const url = process.env.BRIEFING_GIST_URL;
  if (!url) {
    return NextResponse.json({ error: "briefing source not configured" }, { status: 500, headers: NO_STORE });
  }

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502, headers: NO_STORE });
    }
    const raw = JSON.stringify(await res.json());
    return new NextResponse(scrub(raw), {
      status: 200,
      headers: { ...NO_STORE, "content-type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "upstream fetch failed" }, { status: 502, headers: NO_STORE });
  }
}
