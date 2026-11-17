import type { NpmReport } from "./reports-types";

export interface BadgeState {
  message: string;
  color: string;
}

/**
 * Factual, non-judgmental badge state for a published tarball.
 * Same disclosure rules as the report pages: withheld matches are never described, only counted as "to review".
 */
export function badgeState(r: NpmReport | undefined): BadgeState {
  if (!r) return { message: "not scanned", color: "#9f9f9f" };
  return badgeStateFor(r.findings.map((f) => f.ruleId), r.withheld);
}

/** Badge state from raw rule ids (crawled report or live scan). */
export function badgeStateFor(ruleIds: string[], withheld = 0): BadgeState {
  const nonMap = ruleIds.filter((id) => !id.startsWith("source-map")).length + withheld;
  const hasMaps = ruleIds.some((id) => id.startsWith("source-map"));
  if (nonMap === 0 && !hasMaps) return { message: "clean tarball", color: "#3fb950" };
  if (nonMap === 0) return { message: "ships source maps", color: "#0a84ff" };
  return { message: `${nonMap} to review`, color: "#d29922" };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Rough Verdana 11px width; good enough for a flat shields-style badge. */
function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    if ("iljtf.,:;|!'I ".includes(ch)) w += 3.6;
    else if ("mwMW@".includes(ch)) w += 9.5;
    else if (ch >= "A" && ch <= "Z") w += 7.4;
    else w += 6.6;
  }
  return Math.ceil(w);
}

export function renderBadge(label: string, { message, color }: BadgeState): string {
  const lw = textWidth(label) + 12;
  const mw = textWidth(message) + 12;
  const w = lw + mw;
  const title = esc(`${label}: ${message}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${title}"><title>${title}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#24292f"/><rect x="${lw}" width="${mw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${esc(label)}</text><text x="${lw / 2}" y="14">${esc(label)}</text><text x="${lw + mw / 2}" y="15" fill="#010101" fill-opacity=".3">${esc(message)}</text><text x="${lw + mw / 2}" y="14">${esc(message)}</text></g></svg>`;
}
