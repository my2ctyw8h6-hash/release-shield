import { badgeState } from "@/lib/badge";
import { renderOgCard } from "@/lib/og";
import { formatBytes, formatNum, getReport } from "@/lib/reports";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string[] }> };

/**
 * GET /api/og/npm/<pkg>.png → 1200×630 social card for /npm/<pkg>.
 * Lives under /api because Next can't nest opengraph-image inside a catch-all segment.
 * Same disclosure rules as the report page and badge: status text comes from badgeState(), no finding details.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const name = (await params).slug.map(decodeURIComponent).join("/").replace(/\.png$/i, "");
  const r = getReport(name);
  if (!r) return new Response("not found", { status: 404 });

  const st = badgeState(r);
  return renderOgCard(
    {
      kicker: "npm tarball audit",
      title: `${r.name}@${r.version}`,
      status: { text: st.message, color: st.color },
      lines: ["What's inside the published package, file by file."],
      stats: [
        { value: formatNum(r.fileCount), label: "files" },
        { value: formatBytes(r.totalBytes), label: "unpacked" },
        ...(r.weeklyDownloads === null ? [] : [{ value: formatNum(r.weeklyDownloads), label: "weekly downloads" }]),
      ],
    },
    { "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" },
  );
}
