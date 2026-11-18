import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { allReports, reportPath, SITE_URL } from "@/lib/reports";

const PATH = "/guides/source-maps-npm";
const REF = "guide-sourcemaps";

export const metadata: Metadata = {
  title: "Source maps in npm packages: check if your tarball ships your source",
  description:
    "Most bundlers write sourcesContent into .map files by default, so publishing maps can publish your original source. How to check a tarball, and the one-line config fix for tsc, esbuild, Rollup, Vite and webpack.",
  alternates: { canonical: `${SITE_URL}${PATH}` },
};

const pre = { overflowX: "auto" as const };

export default function SourceMapsNpm() {
  const reports = allReports();
  const n = reports.length;
  const withMaps = reports.filter((r) => r.findings.some((f) => f.ruleId.startsWith("source-map")));
  const embedded = reports.filter((r) => r.findings.some((f) => f.ruleId === "source-map-embedded"));
  const pct = (k: number) => (n ? `${Math.round((k / n) * 100)}%` : "0%");
  const examples = embedded.slice(0, 12);

  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <Logo />
          <nav>
            <a href="/npm">Package reports</a>
            <a href="/docs">Docs</a>
            <a href={`/?ref=${REF}#check`} className="btn btn-sm btn-primary">Scan a package</a>
          </nav>
        </div>
      </header>
      <main className="docs container">
        <h1>Source maps in npm packages</h1>
        <p className="muted">
          A <code>.map</code> file can hold the full original source of every file that went into the bundle. If it&apos;s in the tarball,
          anyone who runs <code>npm pack</code> on your package has it.
        </p>

        <h2>1. What&apos;s actually in a .map</h2>
        <pre style={pre}><code>{`{
  "version": 3,
  "sources": ["../src/client.ts", "../src/auth.ts"],
  "sourcesContent": ["import ... // full original file", "..."],
  "mappings": "AAAA,SAAS..."
}`}</code></pre>
        <p>
          <code>sources</code> leaks file names and layout. <code>sourcesContent</code> is the actual pre-build code, comments, internal
          URLs and TODOs included. Without <code>sourcesContent</code> a map is mostly noise; with it, minification undid nothing.
        </p>

        <h2>2. How common it is</h2>
        <p>
          Of the {n} popular packages we scanned, {withMaps.length} ({pct(withMaps.length)}) publish <code>.map</code> files and{" "}
          {embedded.length} ({pct(embedded.length)}) inline <code>sourcesContent</code>. For open-source packages that&apos;s just weight. For a
          closed-source SDK, CLI or paid library it&apos;s the codebase. Full numbers:{" "}
          <a href="/report/npm-tarball-audit-2026">npm tarball audit 2026</a>.
        </p>

        <h2>3. Check a tarball in 30 seconds</h2>
        <pre style={pre}><code>{`# your package, before publishing
npm pack
# or anything already on the registry
npm pack some-package@latest

mkdir t && tar -xzf *.tgz -C t
find t -name '*.map' | while read f; do
  jq -r --arg f "$f" '(.sourcesContent // []) | map(select(. != null)) | length
    | if . > 0 then "\\($f): \\(.) files of source inlined" else empty end' "$f"
done`}</code></pre>
        <p>
          No output means no inlined source. Maps without <code>sourcesContent</code> still expose paths; decide if you need them at all.
        </p>

        <h2>4. Turn it off where it&apos;s made</h2>
        <table>
          <thead>
            <tr><th>Tool</th><th>Default</th><th>Fix</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>tsc</td>
              <td>no source unless <code>inlineSources</code></td>
              <td>drop <code>&quot;inlineSources&quot;: true</code>, or <code>&quot;sourceMap&quot;: false</code> in the publish tsconfig</td>
            </tr>
            <tr>
              <td>esbuild</td>
              <td>includes source</td>
              <td><code>sourcesContent: false</code> (CLI: <code>--sources-content=false</code>)</td>
            </tr>
            <tr>
              <td>Rollup</td>
              <td>includes source</td>
              <td><code>output.sourcemapExcludeSources: true</code></td>
            </tr>
            <tr>
              <td>Vite</td>
              <td>no maps unless <code>build.sourcemap</code> is set</td>
              <td>leave <code>build.sourcemap</code> off for the published build</td>
            </tr>
            <tr>
              <td>webpack</td>
              <td><code>devtool: false</code> in production mode</td>
              <td>if you need maps: <code>devtool: &quot;nosources-source-map&quot;</code></td>
            </tr>
          </tbody>
        </table>

        <h2>5. Or keep them out of the tarball</h2>
        <p>
          If you want maps for your own error tracker, upload them there and exclude them from the package. With a <code>files</code> allowlist,
          ignore files can&apos;t remove anything it includes, so negate inside the array:
        </p>
        <pre style={pre}><code>{`"files": ["dist", "!dist/**/*.map"]`}</code></pre>
        <p>
          Using <code>.npmignore</code> instead? Read <a href="/guides/npmignore-trap">the .npmignore trap</a> first: it replaces{" "}
          <code>.gitignore</code>, so <code>dist/*.map</code> in <code>.gitignore</code> stops applying the moment you add one.
        </p>

        <h2>Why your git scanner says nothing</h2>
        <p>
          Maps are build output. They&apos;re gitignored, never committed, and written to disk right before <code>npm publish</code>. Push
          protection and history scanners only see commits. The tarball is the only place to look.
        </p>

        {examples.length > 0 && (
          <>
            <h2>Packages that currently inline source</h2>
            <p className="small muted">Open-source packages, so nothing secret; shown as real examples of the default.</p>
            <ul>
              {examples.map((r) => (
                <li key={r.name}>
                  <a href={reportPath(r.name)}>{r.name}</a>
                </li>
              ))}
            </ul>
          </>
        )}

        <h2>Check yours</h2>
        <p>
          <a href={`/?ref=${REF}#check`}>Scan any published package or upload a tarball</a>, free, no login. It flags maps, inlined source,
          secrets and stray files in everything that would ship. Or <a href="/docs">fail the publish in CI</a> when a new one appears.
        </p>
      </main>
    </>
  );
}
