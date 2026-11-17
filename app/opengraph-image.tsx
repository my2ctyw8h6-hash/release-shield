import { OG_SIZE, renderOgCard } from "@/lib/og";

export const alt = "ReleaseShield: scan the npm, PyPI or Docker artifact you publish for source maps, .env files and secrets";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return renderOgCard({
    kicker: "pre-publish leak scanner",
    title: "Check what your npm package actually ships",
    lines: ["Source maps, .env files, keys and internal docs in the final tarball.", "Free scan of any public package. CI gate for every release."],
    stats: [
      { value: "npm", label: "tarballs" },
      { value: "PyPI", label: "wheels + sdists" },
      { value: "Docker", label: "images" },
    ],
  });
}
