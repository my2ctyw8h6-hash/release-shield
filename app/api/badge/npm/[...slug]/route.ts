import { badgeState, renderBadge } from "@/lib/badge";
import { getReport } from "@/lib/reports";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string[] }> };

/** GET /api/badge/npm/<pkg>.svg (scoped: /api/badge/npm/@scope/name.svg) → README badge from the latest report. */
export async function GET(_req: Request, { params }: Ctx) {
  const name = (await params).slug.map(decodeURIComponent).join("/").replace(/\.svg$/i, "");
  const svg = renderBadge("ReleaseShield", badgeState(getReport(name)));
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      // GitHub's camo proxy respects this; reports refresh daily.
      "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
