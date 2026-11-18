/**
 * SEO crawler: scans popular public npm packages with the ReleaseShield engine
 * and writes compact, publication-safe summaries to content/npm-reports.json,
 * which powers the static /npm/<package> report pages.
 *
 * Run from the app root; /root/seo-engine.sh bundles it to /tmp and executes it with [--max 40].
 *
 * Responsible-disclosure policy (enforced in lib/public-report.ts, before anything is written to disk):
 *  - Content findings (secret patterns) are NEVER published with file paths or evidence, only counts.
 *  - Path findings for sensitive categories (.env, keys, credentials, DB dumps, .git) are published as counts only.
 *  - File paths are shown only for harmless hygiene categories (source maps, docs, tests, IDE files…).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildReport } from "../lib/public-report";
import type { ReportsFile } from "../lib/reports-types";

// Resolve from the app root (cwd): the bundled script runs from /tmp.
const CONTENT_DIR = join(process.cwd(), "content");
const OUT = join(CONTENT_DIR, "npm-reports.json");
const RESCAN_AFTER_MS = 14 * 24 * 3600 * 1000;
const argMax = process.argv.indexOf("--max");
const MAX_SCANS = argMax > 0 ? Number(process.argv[argMax + 1]) : 40;

// Seed queries skew toward packages whose maintainers/users are our buyers: SDKs, CLIs, build tooling, AI.
const SEEDS = [
  "keywords:sdk", "keywords:cli", "keywords:api-client", "keywords:ai", "keywords:llm", "keywords:openai",
  "keywords:anthropic", "keywords:mcp", "keywords:typescript", "keywords:react", "keywords:vite-plugin",
  "keywords:eslint-plugin", "keywords:nextjs", "keywords:webpack", "keywords:auth", "keywords:database",
  "keywords:orm", "keywords:testing", "keywords:logger", "keywords:http", "keywords:aws", "keywords:stripe",
  "keywords:serverless", "keywords:framework", "keywords:security",
];

interface SearchObj { package: { name: string; description?: string } }

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "releaseshield-seo-crawler" } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

async function candidates(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const q of SEEDS) {
    const data = await getJson<{ objects: SearchObj[] }>(
      `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=100&popularity=1.0&quality=0.3&maintenance=0.3`,
    );
    for (const o of data?.objects ?? []) if (!out.has(o.package.name)) out.set(o.package.name, o.package.description ?? "");
  }
  return out;
}

async function main() {
  mkdirSync(CONTENT_DIR, { recursive: true });
  let db: ReportsFile = { generatedAt: new Date(0).toISOString(), reports: {} };
  try {
    db = JSON.parse(readFileSync(OUT, "utf8")) as ReportsFile;
  } catch {}

  const pool = await candidates();
  const now = Date.now();
  // Unscanned first, then stalest.
  const queue = [...pool.keys()]
    .filter((n) => !db.reports[n] || now - Date.parse(db.reports[n].scannedAt) > RESCAN_AFTER_MS)
    .sort((a, b) => (db.reports[a] ? Date.parse(db.reports[a].scannedAt) : 0) - (db.reports[b] ? Date.parse(db.reports[b].scannedAt) : 0))
    .slice(0, MAX_SCANS);

  console.log(`pool=${pool.size} known=${Object.keys(db.reports).length} queue=${queue.length}`);
  let ok = 0;
  for (const name of queue) {
    try {
      const report = await buildReport(name, pool.get(name) ?? "");
      db.reports[report.name] = report;
      ok++;
      console.log(`✓ ${report.name}@${report.version} grade ${report.grade} (${report.findings.length} findings, ${report.withheld} withheld)`);
    } catch (err) {
      console.log(`✗ ${name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  db.generatedAt = new Date().toISOString();
  // Stable key order keeps git diffs small.
  db.reports = Object.fromEntries(Object.entries(db.reports).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(OUT, JSON.stringify(db, null, 1) + "\n");
  console.log(`scanned=${ok} total=${Object.keys(db.reports).length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
