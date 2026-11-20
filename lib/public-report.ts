import { fetchNpmTarball } from "./npm";
import { scanArchive } from "./scanner";
import { CONTENT_RULES } from "./rules";
import type { NpmReport, PublicFinding } from "./reports-types";

/**
 * Turns a raw scan into a report that is safe to publish. Shared by the nightly crawler
 * (scripts/seo-crawl.ts) and on-demand /npm/<pkg> pages.
 *
 * Responsible-disclosure policy:
 *  - Content findings (secret patterns) are NEVER published with file paths or evidence, only counts.
 *  - Path findings for sensitive categories (.env, keys, credentials, DB dumps, .git) are counts only.
 *  - File paths are shown only for harmless hygiene categories (source maps, docs, tests, IDE files...).
 */
const SENSITIVE_PATH_RULES = new Set(["env-file", "private-key-file", "credentials-file", "database-dump", "git-dir"]);
const CONTENT_RULE_IDS = new Set(CONTENT_RULES.map((r) => r.id));

export const REPORT_MAX_BYTES = 15 * 1024 * 1024;

// npm's own name rules: lowercase, url-safe, optional scope, max 214 chars.
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
export function isNpmName(name: string): boolean {
  return name.length <= 214 && NPM_NAME.test(name);
}

export function sanitize(findings: ReturnType<typeof scanArchive>["findings"]): { findings: PublicFinding[]; withheld: number } {
  const out: PublicFinding[] = [];
  let withheld = 0;
  for (const f of findings) {
    const n = f.occurrences ?? 1;
    if (CONTENT_RULE_IDS.has(f.ruleId) || SENSITIVE_PATH_RULES.has(f.ruleId)) {
      withheld += n;
      continue;
    }
    out.push({ ruleId: f.ruleId, title: f.title, severity: f.severity, file: f.file.slice(0, 160), occurrences: n, advice: f.advice });
  }
  return { findings: out.slice(0, 25), withheld };
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "user-agent": "releaseshield" } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function weeklyDownloads(name: string): Promise<number | null> {
  const d = await getJson<{ downloads?: number }>(`https://api.npmjs.org/downloads/point/last-week/${name}`);
  // 0 from a failed or empty lookup is a false zero; report unknown as null.
  return d?.downloads || null;
}

/**
 * Fetch the latest tarball, scan it, and build a publishable report. Throws on unknown/oversized packages.
 * isr: called from an ISR page, where no-store fetches are not allowed.
 */
export async function buildReport(name: string, description?: string, isr = false): Promise<NpmReport> {
  const pkg = await fetchNpmTarball(name, { maxBytes: REPORT_MAX_BYTES, noStore: !isr });
  const r = scanArchive(pkg.data, { target: pkg.name, version: pkg.version, source: "npm" });
  const { findings, withheld } = sanitize(r.findings);
  const desc =
    description ??
    (await getJson<{ description?: string }>(`https://registry.npmjs.org/${pkg.name.replace("/", "%2f")}/${pkg.version}`))?.description ??
    "";
  return {
    name: pkg.name,
    version: pkg.version,
    description: desc.slice(0, 200),
    weeklyDownloads: await weeklyDownloads(pkg.name),
    grade: r.grade,
    score: r.score,
    fileCount: r.fileCount,
    totalBytes: r.totalBytes,
    counts: r.counts,
    findings,
    withheld,
    scannedAt: new Date().toISOString(),
  };
}
