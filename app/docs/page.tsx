import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { ACTION_REF, CLI_GET } from "@/lib/site";

export const metadata: Metadata = {
  title: "Docs: ReleaseShield CLI & GitHub Action",
  description: "Install the ReleaseShield CLI and GitHub Action to block leaky npm, PyPI and Docker releases in CI.",
};

const OPTIONS: [string, string, string][] = [
  ["--fail-on <level>", "Exit 1 on findings at/above critical | high | medium | low | none (default critical)", "Standard"],
  ["--format <fmt>", "text | json | sarif | markdown", "Standard"],
  ["-o, --output <file>", "Write the report to a file", "Free"],
  ["--slack-webhook <url>", "Alert Slack on critical/high findings (or RELEASESHIELD_SLACK_WEBHOOK)", "Standard"],
  ["--config <file>", "Policy file (default .releaseshield.json)", "Pro / Team"],
  ["--ignore <glob>", "Skip matching files (repeatable)", "Pro / Team"],
  ["--ignore-rule <id>", "Suppress a rule such as source-map (repeatable)", "Pro / Team"],
  ["--baseline <spec>", "Diff vs a previous release: auto | npm:<pkg>@<ver> | file", "Pro / Team"],
  ["--registry <url>", "Private npm registry (auth via NPM_TOKEN)", "Pro / Team"],
];

export default function Docs() {
  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <Logo />
          <nav>
            <a href="/#check">Free scan</a>
            <a href="/#pricing">Pricing</a>
          </nav>
        </div>
      </header>
      <main className="docs container narrow">
        <h1>ReleaseShield docs</h1>
        <p className="muted">
          ReleaseShield scans the exact artifact you&apos;re about to publish (npm tarball, Python wheel/sdist or Docker image) and blocks the
          release if it contains source maps, <code>.env</code> files, keys, tokens or internal files.
        </p>

        <h2>1. Get your license token</h2>
        <p className="muted">
          After checkout you land on a page that shows your token (<code>rs_…</code>). Add it to your CI secrets as{" "}
          <code>RELEASESHIELD_TOKEN</code>. Standard ($19/mo) covers up to 5 packages or repos; Pro / Team ($49/mo) is unlimited.
          Without a token everything still runs, in free report-only mode.
        </p>

        <h2>2. GitHub Actions</h2>
        <pre className="code">
          <code>{`name: release
on: { release: { types: [published] } }
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions: { contents: read, security-events: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, registry-url: https://registry.npmjs.org }
      - run: npm ci
      - id: shield
        uses: ${ACTION_REF}
        with:
          token: \${{ secrets.RELEASESHIELD_TOKEN }}
          fail-on: critical
          sarif-output: releaseshield.sarif
          slack-webhook: \${{ secrets.SLACK_WEBHOOK }}
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with: { sarif_file: releaseshield.sarif }
      - run: npm publish
        env: { NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }} }`}</code>
        </pre>
        <p className="muted small">
          With no <code>artifact</code> input the action runs <code>npm pack</code> in the package, or scans <code>dist/*.whl</code> /{" "}
          <code>dist/*.tar.gz</code> for Python. For Docker use <code>artifact: docker:my-app:latest</code> after your build step.
          Outputs: <code>grade</code>, <code>score</code>, <code>findings</code>, <code>critical</code>, <code>failed</code>, <code>plan</code>,{" "}
          <code>report-path</code>, <code>sarif-path</code>.
        </p>

        <h2>3. CLI (any CI or your laptop)</h2>
        <pre className="code">
          <code>{`${CLI_GET}   # single file, no dependencies, Node 20+

node releaseshield.mjs scan                      # npm pack the current package and scan it
node releaseshield.mjs scan dist/*.whl           # Python wheels / sdists
node releaseshield.mjs scan docker:my-app:1.4.0  # Docker image (via docker save)
node releaseshield.mjs scan npm:some-pkg@2.0.0   # an already-published npm version
node releaseshield.mjs license                   # check your plan

# GitLab CI / CircleCI / Jenkins
${CLI_GET}
RELEASESHIELD_TOKEN=$TOKEN node releaseshield.mjs scan --fail-on high --format sarif -o gl-sast.sarif`}</code>
        </pre>
        <table>
          <thead>
            <tr>
              <th>Option</th>
              <th>What it does</th>
              <th>Plan</th>
            </tr>
          </thead>
          <tbody>
            {OPTIONS.map(([o, d, p]) => (
              <tr key={o}>
                <td>
                  <code>{o}</code>
                </td>
                <td className="muted">{d}</td>
                <td>{p}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Exit codes: 0 pass · 1 release blocked · 2 scan error.</p>

        <h2>4. Policies (Pro / Team)</h2>
        <pre className="code">
          <code>{`// .releaseshield.json
{
  "failOn": "high",
  "ignore": ["docs/public/**", "*.test.js"],
  "ignoreRules": ["internal-host"],
  "baseline": "auto"
}`}</code>
        </pre>
        <p className="muted small">
          <code>baseline: &quot;auto&quot;</code> compares against the latest published version on npm and lists every file that&apos;s new in this release.
        </p>

        <h2>Licensing &amp; privacy</h2>
        <p className="muted">
          Scans run entirely on your runner, so your code never leaves it. The CLI checks your token&apos;s signature offline and asks our server
          whether the subscription is still active. If our server can&apos;t be reached, it keeps working on your signed plan, so our outage
          never blocks your release.
        </p>
      </main>
    </>
  );
}
