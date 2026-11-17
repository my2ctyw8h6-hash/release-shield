import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/reports";

export default function robots(): MetadataRoute.Robots {
  return {
    // og/badge images must be fetchable by card crawlers (Twitterbot honors robots.txt).
    rules: [{ userAgent: "*", allow: ["/", "/api/og/", "/api/badge/"], disallow: ["/api/", "/success"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
