import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const STATUS_FILE = "studio-status.json";

function keyMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const TOKEN_RE =
  /(?:sk-ant-|sk_live_|sk_test_|rk_live_|rk_test_|whsec_|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|xox[abprs]-|AKIA)[A-Za-z0-9_-]+/g;

/** Redact /root/ paths, known secret token prefixes, and our own env secrets. */
function scrub(json: string): string {
  let out = json
    .replace(/\/root\/[^\s"'\\,]*/g, "[redacted-path]")
    .replace(TOKEN_RE, "[redacted-token]");
  for (const secret of [process.env.BRIEFING_GH_TOKEN, process.env.MUSE_BRIEFING_KEY]) {
    if (secret && secret.length >= 8) out = out.split(secret).join("[redacted-token]");
  }
  return out;
}

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

/** Key-gated, scrubbed passthrough of studio-status.json from a private gist. */
export async function GET(req: NextRequest) {
  if (!keyMatches(req.nextUrl.searchParams.get("key"), process.env.MUSE_BRIEFING_KEY)) {
    return fail("unauthorized", 401);
  }

  const gistId = process.env.BRIEFING_GIST_ID;
  const token = process.env.BRIEFING_GH_TOKEN;
  if (!gistId || !token) return fail("briefing source not configured", 500);

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  try {
    const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
      headers,
      cache: "no-store",
    });
    if (!res.ok) return fail(`upstream ${res.status}`, 502);

    const data = await res.json();
    const file = data?.files?.[STATUS_FILE];
    if (!file) return fail(`${STATUS_FILE} not found in gist`, 502);

    // Gist API truncates file content over ~1MB; fall back to raw_url.
    let content: string = file.content ?? "";
    if (file.truncated && file.raw_url) {
      const raw = await fetch(file.raw_url, { headers, cache: "no-store" });
      if (!raw.ok) return fail(`upstream raw ${raw.status}`, 502);
      content = await raw.text();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return fail(`${STATUS_FILE} is not valid JSON`, 502);
    }

    return new NextResponse(scrub(JSON.stringify(parsed)), {
      status: 200,
      headers: { ...NO_STORE, "content-type": "application/json" },
    });
  } catch {
    return fail("upstream fetch failed", 502);
  }
}
