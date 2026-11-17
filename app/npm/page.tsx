import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { allReports, formatBytes, formatNum, reportPath, reportsGeneratedAt } from "@/lib/reports";

export const metadata: Metadata = {
  title: "Which popular npm packages ship source maps? npm tarball audits",
  description:
    "We scan the published tarballs of popular npm packages for source maps, environment files, internal docs and other files that shouldn't ship. Browse the reports.",
};

export default function NpmIndex() {
  const reports = allReports().sort((a, b) => b.weeklyDownloads - a.weeklyDownloads);
  const withMaps = reports.filter((r) => r.findings.some((f) => f.ruleId.startsWith("source-map")));
  const embedded = reports.filter((r) => r.findings.some((f) => f.ruleId === "source-map-embedded"));
  const clean = reports.filter((r) => r.findings.length === 0 && r.withheld === 0);
  const pct = (n: number) => (reports.length ? Math.round((n / reports.length) * 100) : 0);
  const updated = reportsGeneratedAt().slice(0, 10);

  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <Logo />
          <nav>
            <a href="/docs">Docs</a>
            <a href="/#pricing">Pricing</a>
            <a href="/#check" className="btn btn-sm btn-primary">Scan a package</a>
          </nav>
        </div>
      </header>
      <main className="docs container">
        <h1>What&apos;s really inside popular npm packages?</h1>
        <p className="muted">
          ReleaseShield scans the exact tarballs that <code>npm install</code> downloads. Here&apos;s what we found across{" "}
          {reports.length} popular packages (updated {updated}).
        </p>

        <div className="counts">
          <div className="count"><strong>{reports.length}</strong><span>packages</span></div>
          <div className="count count-medium"><strong>{pct(withMaps.length)}%</strong><span>ship source maps</span></div>
          <div className="count count-high"><strong>{pct(embedded.length)}%</strong><span>embed full source</span></div>
          <div className="count"><strong>{pct(clean.length)}%</strong><span>fully clean</span></div>
        </div>

        <p className="muted small">
          Shipping source maps isn&apos;t a problem for open-source code, but for a closed-source package it hands over the original
          source. <a href="/report/npm-tarball-audit-2026">Read the 2026 audit</a>, <a href="/#check">scan your own package free</a>, or <a href="/docs">gate every release in CI</a>.
        </p>

        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th>Package</th>
                <th>Version</th>
                <th>Weekly downloads</th>
                <th>Files</th>
                <th>Unpacked</th>
                <th>Notable contents</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const kinds = [...new Set(r.findings.map((f) => f.title))];
                return (
                  <tr key={r.name} style={{ borderTop: "1px solid var(--border)" }}>
                    <td><a href={reportPath(r.name)}>{r.name}</a></td>
                    <td><code>{r.version}</code></td>
                    <td>{formatNum(r.weeklyDownloads)}</td>
                    <td>{formatNum(r.fileCount)}</td>
                    <td>{formatBytes(r.totalBytes)}</td>
                    <td className="muted">{kinds.length ? kinds.slice(0, 2).join(", ") : r.withheld ? "see report" : "✓ clean"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: "2rem" }}>
          Automated heuristic scans of public tarballs. Results describe contents, not the security of a package or its maintainers.
          Details of possible credentials are never published.
        </p>
      </main>
    </>
  );
}
