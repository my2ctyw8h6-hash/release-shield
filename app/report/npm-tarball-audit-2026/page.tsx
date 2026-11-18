import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { allReports, formatBytes, formatNum, reportPath, reportsGeneratedAt } from "@/lib/reports";

export const metadata: Metadata = {
  title: "npm tarball audit 2026: source maps, bloat and stray files in published packages",
  description:
    "Aggregate results from scanning the published tarballs of npm packages: how many ship source maps, embed full original source, or run to megabytes unpacked.",
};

const MB = 1024 * 1024;

export default function TarballAudit2026() {
  const reports = allReports();
  const n = reports.length;
  const pct = (k: number) => (n ? `${Math.round((k / n) * 100)}%` : "0%");
  const has = (id: (ruleId: string) => boolean) => reports.filter((r) => r.findings.some((f) => id(f.ruleId))).length;

  const maps = has((id) => id.startsWith("source-map"));
  const embedded = has((id) => id === "source-map-embedded");
  const ciConfig = has((id) => id === "ci-config");
  const ideConfig = has((id) => id === "ide-config");
  const coverage = has((id) => id === "test-coverage");
  const withheld = reports.filter((r) => r.withheld > 0).length;
  const clean = reports.filter((r) => r.findings.length === 0 && r.withheld === 0).length;

  const sizes = reports.map((r) => r.totalBytes).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] ?? 0;
  const over1 = sizes.filter((s) => s > MB).length;
  const over10 = sizes.filter((s) => s > 10 * MB).length;
  const largest = [...reports].sort((a, b) => b.totalBytes - a.totalBytes).slice(0, 10);
  const mapFiles = reports.reduce(
    (sum, r) => sum + r.findings.filter((f) => f.ruleId.startsWith("source-map")).reduce((s, f) => s + f.occurrences, 0),
    0,
  );
  const updated = reportsGeneratedAt().slice(0, 10);

  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <Logo />
          <nav>
            <a href="/npm">Package reports</a>
            <a href="/docs">Docs</a>
            <a href="/#check" className="btn btn-sm btn-primary">Scan a package</a>
          </nav>
        </div>
      </header>
      <main className="docs container">
        <h1>npm tarball audit 2026</h1>
        <p className="muted">
          We downloaded the latest published tarball of {n} npm packages, the exact bytes <code>npm install</code> fetches, and
          inspected every file. Numbers below are recomputed on every crawl (last run {updated}).
        </p>

        <div className="counts">
          <div className="count count-medium"><strong>{pct(maps)}</strong><span>ship source maps</span></div>
          <div className="count count-high"><strong>{pct(embedded)}</strong><span>embed full original source</span></div>
          <div className="count"><strong>{pct(over1)}</strong><span>over 1 MB unpacked</span></div>
          <div className="count"><strong>{pct(clean)}</strong><span>nothing flagged</span></div>
        </div>

        <h2>1. Source maps are the norm</h2>
        <p>
          {maps} of {n} packages ({pct(maps)}) publish <code>.map</code> files, {formatNum(mapFiles)} map files in total. {embedded}{" "}
          ({pct(embedded)}) go further and inline <code>sourcesContent</code>, which means the original, pre-build source is sitting in
          the tarball. For open-source code that&apos;s harmless weight. For a closed-source SDK or CLI it&apos;s the whole codebase.
        </p>

        <h2>2. Tarballs are bigger than they need to be</h2>
        <p>
          Median unpacked size is {formatBytes(median)}. {over1} packages ({pct(over1)}) exceed 1 MB and {over10} exceed 10 MB. Size
          alone isn&apos;t a leak, but it&apos;s the usual symptom: maps, tests, fixtures and build leftovers that a <code>files</code>{" "}
          allowlist in <code>package.json</code> would have dropped.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th>Largest packages</th>
                <th>Version</th>
                <th>Files</th>
                <th>Unpacked</th>
              </tr>
            </thead>
            <tbody>
              {largest.map((r) => (
                <tr key={r.name} style={{ borderTop: "1px solid var(--border)" }}>
                  <td><a href={reportPath(r.name)}>{r.name}</a></td>
                  <td><code>{r.version}</code></td>
                  <td>{formatNum(r.fileCount)}</td>
                  <td>{formatBytes(r.totalBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2>3. Stray files and possible credentials</h2>
        <p>
          Smaller but real: {ciConfig} package{ciConfig === 1 ? "" : "s"} shipped CI config, {ideConfig} shipped editor config and{" "}
          {coverage} shipped test-coverage output. {withheld} package{withheld === 1 ? "" : "s"} ({pct(withheld)}) matched a secret
          pattern or sensitive-file rule. We don&apos;t publish which ones or what matched; some are test fixtures, and the rest
          belong with the maintainer, not on a web page.
        </p>

        <h2>Check yours</h2>
        <p>
          Every one of these was a build-config default nobody looked at (see <a href="/guides/npmignore-trap">the .npmignore trap</a>
          for how files git never saw end up in a tarball, and <a href="/guides/source-maps-npm">source maps in npm packages</a> for
          the per-bundler fix). <a href="/#check">Scan your package free</a> (no login, the
          same scanner), or <a href="/docs">fail the publish in CI</a> when something new shows up.
        </p>

        <p className="small muted" style={{ marginTop: "2rem" }}>
          Method: automated heuristic scan of each package&apos;s latest public tarball. Sizes are unpacked. Results describe tarball
          contents, not the security of a package or its maintainers. Per-package results: <a href="/npm">npm package reports</a>.
        </p>
      </main>
    </>
  );
}
