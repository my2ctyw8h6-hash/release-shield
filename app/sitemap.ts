import type { MetadataRoute } from "next";
import { allReports, reportPath, reportsGeneratedAt, SITE_URL } from "@/lib/reports";

export default function sitemap(): MetadataRoute.Sitemap {
  const updated = new Date(reportsGeneratedAt());
  return [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/docs`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/npm`, lastModified: updated, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/guides/npmignore-trap`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/report/npm-tarball-audit-2026`, lastModified: updated, changeFrequency: "daily", priority: 0.8 },
    ...allReports().map((r) => ({
      url: `${SITE_URL}${reportPath(r.name)}`,
      lastModified: new Date(r.scannedAt),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
