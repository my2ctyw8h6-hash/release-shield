import { badgeState, badgeStateFor, renderBadge, type BadgeState } from "@/lib/badge";
import { getReport } from "@/lib/reports";
import { fetchNpmTarball } from "@/lib/npm";
import { scanArchive } from "@/lib/scanner";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ slug: string[] }> };

// GitHub's camo proxy respects this; reports refresh daily.
const CACHED = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

/**
 * GET /api/badge/npm/<pkg>.svg (scoped: /api/badge/npm/@scope/name.svg) → README badge.
 * Crawled packages use the latest report. Anything else gets a live scan of the latest
 * published tarball, cached at the CDN for a day so README views don't trigger rescans.
 */
export async function GET(req: Request, { params }: Ctx) {
  const name = (await params).slug.map(decodeURIComponent).join("/").replace(/\.svg$/i, "");
  const report = getReport(name);
  if (report) return svg(badgeState(report), CACHED);

  // Cache misses only; the CDN absorbs repeat views.
  if (!rateLimit(`badge:${clientIp(req)}`, 20, 60_000).ok) return svg(badgeState(undefined), "no-store");
  try {
    const pkg = await fetchNpmTarball(name);
    const live = scanArchive(pkg.data, { target: pkg.name, version: pkg.version, source: "npm" });
    return svg(badgeStateFor(live.findings.map((f) => f.ruleId)), CACHED);
  } catch {
    // Unknown package or registry hiccup: grey badge, retry soon.
    return svg(badgeState(undefined), "public, max-age=300, s-maxage=600");
  }
}

function svg(state: BadgeState, cacheControl: string) {
  return new Response(renderBadge("ReleaseShield", state), {
    headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": cacheControl },
  });
}
