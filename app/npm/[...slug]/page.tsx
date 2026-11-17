import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Logo } from "@/components/Logo";
import { allReports, formatBytes, formatNum, getReport, reportPath, slugFor, SITE_URL } from "@/lib/reports";
import { ACTION_REF } from "@/lib/site";
import type { NpmReport, PublicFinding } from "@/lib/reports-types";

export const dynamicParams = false;

type Props = { params: Promise<{ slug: string[] }> };

export function generateStaticParams() {
  return allReports().map((r) => ({ slug: slugFor(r.name) }));
}

function nameFrom(slug: string[]): string {
  return slug.map(decodeURIComponent).join("/");
}

function headline(r: NpmReport): string {
  const maps = r.findings.filter((f) => f.ruleId.startsWith("source-map")).reduce((n, f) => n + f.occurrences, 0);
  const other = r.findings.length + r.withheld;
  if (other === 0) return `${r.name}@${r.version} ships a clean tarball: ${r.fileCount} files, nothing unexpected.`;
  if (maps > 0) return `${r.name}@${r.version} ships ${r.fileCount} files, including ${maps} source map file${maps === 1 ? "" : "s"}.`;
  return `${r.name}@${r.version} ships ${r.fileCount} files; ${other} item${other === 1 ? "" : "s"} worth a look.`;
}

const ogImage = (name: string) => `${SITE_URL}/api/og/npm/${name}.png`;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = getReport(nameFrom((await params).slug));
  if (!r) return {};
  const title = `What ships in ${r.name}@${r.version}? npm tarball audit`;
  return {
    title,
    description: `${headline(r)} Automated pre-publish audit of the ${r.name} npm package by ReleaseShield.`,
    alternates: { canonical: `${SITE_URL}${reportPath(r.name)}` },
    openGraph: { title, description: headline(r), type: "article", images: [{ url: ogImage(r.name), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description: headline(r), images: [ogImage(r.name)] },
  };
}

function group(findings: PublicFinding[]) {
  const m = new Map<string, { title: string; severity: string; advice: string; files: PublicFinding[]; total: number }>();
  for (const f of findings) {
    const g = m.get(f.ruleId) ?? { title: f.title, severity: f.severity, advice: f.advice, files: [], total: 0 };
    g.files.push(f);
    g.total += f.occurrences;
    m.set(f.ruleId, g);
  }
  return [...m.entries()];
}

function related(r: NpmReport): NpmReport[] {
  const scope = r.name.startsWith("@") ? r.name.split("/")[0] : null;
  const all = allReports().filter((x) => x.name !== r.name);
  const same = scope ? all.filter((x) => x.name.startsWith(scope + "/")) : [];
  const popular = [...all].sort((a, b) => b.weeklyDownloads - a.weeklyDownloads);
  return [...new Map([...same, ...popular].map((x) => [x.name, x])).values()].slice(0, 12);
}

export default async function PackageReport({ params }: Props) {
  const r = getReport(nameFrom((await params).slug));
  if (!r) notFound();
  const groups = group(r.findings);
  const hasMaps = r.findings.some((f) => f.ruleId.startsWith("source-map"));
  const scanned = new Date(r.scannedAt).toISOString().slice(0, 10);
  const badgeUrl = `${SITE_URL}/api/badge/npm/${r.name}.svg`;

  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <Logo />
          <nav>
            <a href="/npm">Package reports</a>
            <a href="/docs">Docs</a>
            <a href="/#pricing">Pricing</a>
            <a href={`/?scan=${encodeURIComponent(r.name)}#check`} className="btn btn-sm btn-primary">Scan live</a>
          </nav>
        </div>
      </header>

      <main className="docs container narrow">
        <p className="small muted">
          <a href="/npm">npm package reports</a> / {r.name}
        </p>
        <h1 style={{ wordBreak: "break-word" }}>What ships in {r.name}?</h1>
        <p className="muted">{headline(r)}</p>
        {r.description && <p className="small muted">“{r.description}”</p>}

        <div className="counts">
          <div className="count"><strong>{r.version}</strong><span>version</span></div>
          <div className="count"><strong>{formatNum(r.fileCount)}</strong><span>files</span></div>
          <div className="count"><strong>{formatBytes(r.totalBytes)}</strong><span>unpacked</span></div>
          <div className="count"><strong>{formatNum(r.weeklyDownloads)}</strong><span>weekly dl</span></div>
        </div>

        <h2>Findings</h2>
        {groups.length === 0 && r.withheld === 0 && (
          <div className="clean">✓ No source maps, environment files, credentials, internal docs or other unexpected files in the published tarball.</div>
        )}
        {groups.length > 0 && (
          <ul className="findings" style={{ maxHeight: "none" }}>
            {groups.map(([id, g]) => (
              <li className="finding" key={id}>
                <span className={`sev sev-${g.severity}`}>{g.total}×</span>
                <div className="finding-body">
                  <div className="finding-title">{g.title}</div>
                  {g.files.slice(0, 5).map((f) => (
                    <code className="finding-file" key={f.file} style={{ display: "block" }}>
                      {f.file}
                      {f.occurrences > 1 ? ` (+${f.occurrences - 1} similar)` : ""}
                    </code>
                  ))}
                  <div className="finding-advice">{g.advice}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {r.withheld > 0 && (
          <div className="alert" style={{ color: "var(--text)" }}>
            {r.withheld} additional match{r.withheld === 1 ? "" : "es"} for secret patterns or sensitive file types {r.withheld === 1 ? "was" : "were"}{" "}
            not published here. Many are test fixtures or documentation examples; we never list details of possible credentials publicly.
            Maintainers can see the details with a <a href={`/?scan=${encodeURIComponent(r.name)}#check`}>live scan</a>.
          </div>
        )}

        {hasMaps && (
          <>
            <h2>Is a shipped source map a problem?</h2>
            <p className="muted">
              It depends. If the package is open source, the original code is public anyway, and the maps just add install size and
              can help with debugging. For proprietary or closed-source packages it&apos;s a real leak: a source map with{" "}
              <code>sourcesContent</code> lets anyone rebuild the original, unminified code, including comments and internal file
              names. This is how a major AI CLI&apos;s full source was exposed through npm in 2026.
            </p>
          </>
        )}

        <h2>Keep it this way: check every release in CI</h2>
        <p className="muted">
          This report covers one published version. ReleaseShield runs on <em>every</em> publish. It scans the exact tarball
          (<code>npm pack</code>), wheel or Docker image your pipeline builds and fails the release before anything unexpected reaches
          the registry.
        </p>
        <pre className="code" style={{ margin: "1rem 0" }}>
          <code>{`# .github/workflows/release.yml
- uses: ${ACTION_REF}
  with:
    fail-on: high
  env:
    RELEASESHIELD_TOKEN: \${{ secrets.RELEASESHIELD_TOKEN }}`}</code>
        </pre>
        <p>
          <a className="btn btn-primary" href="/#pricing">See plans: from $19/mo</a>{" "}
          <a className="btn btn-outline" href={`/?scan=${encodeURIComponent(r.name)}#check`}>Re-scan {r.name} live</a>
        </p>

        <h2>Maintainer? Show it in your README</h2>
        <p className="muted">
          The badge reflects the latest automated scan of the published tarball and refreshes on its own.{" "}
          <img src={badgeUrl} alt={`ReleaseShield report for ${r.name}`} height={20} style={{ verticalAlign: "middle" }} />
        </p>
        <pre className="code" style={{ margin: "1rem 0", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          <code>{`[![ReleaseShield](${badgeUrl})](${SITE_URL}${reportPath(r.name)}?ref=badge)`}</code>
        </pre>

        <h2>Other package reports</h2>
        <p className="small">
          {related(r).map((x, i) => (
            <span key={x.name}>
              {i > 0 && " · "}
              <a href={reportPath(x.name)}>{x.name}</a>
            </span>
          ))}
        </p>

        <p className="small muted" style={{ marginTop: "2.5rem" }}>
          Automated heuristic scan of the public tarball for {r.name}@{r.version}, run on {scanned}. Findings describe file contents and
          are not a judgment of the package&apos;s security or its maintainers; many are intentional. Maintainer and want this report
          removed or refreshed? Open an issue at{" "}
          <a href="https://github.com/my2ctyw8h6-hash/release-shield/issues">github.com/my2ctyw8h6-hash/release-shield</a>.
        </p>
      </main>
    </>
  );
}
