import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "ReleaseShield: Catch leaks before you publish",
  description:
    "ReleaseShield scans the final npm, PyPI and Docker artifacts your CI publishes for source maps, .env files, secrets and internal code before they leak.",
  openGraph: {
    title: "ReleaseShield: Catch leaks before you publish",
    description: "Free leak check for any npm package. Source maps, .env files, keys and internal docs, found in seconds.",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#0b0f17" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
