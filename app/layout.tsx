import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PageviewTracker } from "@/components/PageviewTracker";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  // Absolute OG/twitter image URLs are built from this; localhost here breaks every social preview in production.
  metadataBase: new URL(SITE_URL),
  title: "ReleaseShield: Catch leaks before you publish",
  description:
    "ReleaseShield scans the final npm, PyPI and Docker artifacts your CI publishes for source maps, .env files, secrets and internal code before they leak.",
  openGraph: {
    title: "ReleaseShield: Catch leaks before you publish",
    description: "Free leak check for any npm package. Source maps, .env files, keys and internal docs, found in seconds.",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#0b0f17" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PageviewTracker />
        {children}
      </body>
    </html>
  );
}
