import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { SITE_URL } from "@/lib/reports";

const PATH = "/guides/npmignore-trap";

export const metadata: Metadata = {
  title: "The .npmignore trap: why npm publish ships files your .gitignore hides",
  description:
    "Adding a .npmignore makes npm stop reading .gitignore, so .env files, source maps and build leftovers end up in the tarball. Git secret scanning never sees them. How it happens and how to check.",
  alternates: { canonical: `${SITE_URL}${PATH}` },
};

const pre = { overflowX: "auto" as const };

export default function NpmignoreTrap() {
  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <Logo />
          <nav>
            <a href="/npm">Package reports</a>
            <a href="/docs">Docs</a>
            <a href={`/?ref=guide-npmignore#check`} className="btn btn-sm btn-primary">Scan a package</a>
          </nav>
        </div>
      </header>
      <main className="docs container">
        <h1>The .npmignore trap</h1>
        <p className="muted">
          Why <code>npm publish</code> ships files that never reached your git repo, and why secret scanning on GitHub can&apos;t catch it.
        </p>

        <h2>1. A .npmignore replaces .gitignore, it doesn&apos;t extend it</h2>
        <p>
          With no <code>.npmignore</code>, npm uses your <code>.gitignore</code> to decide what to leave out. The moment you add a{" "}
          <code>.npmignore</code> (usually to drop <code>src/</code> or <code>test/</code>), npm stops reading <code>.gitignore</code> for that
          directory. Everything git was hiding is back in scope.
        </p>
        <pre style={pre}><code>{`# .gitignore
node_modules
.env
dist/*.map
coverage/

# .npmignore  (added later "to make the package smaller")
src/
test/

# result: .env, dist/*.map and coverage/ are now in the tarball`}</code></pre>

        <h2>2. npm packs the working directory, not the commit</h2>
        <p>
          <code>npm pack</code> and <code>npm publish</code> read files from disk. Gitignored files exist on disk: the <code>.env</code> on your
          laptop, the source maps your bundler just wrote to <code>dist/</code>, the coverage report from the test step that ran before publish
          in CI. None of them were ever committed, so push protection, gitleaks, or any scanner that walks git history has nothing to look at.
          The tarball is a separate artifact and nobody inspects it.
        </p>

        <h2>3. &quot;files&quot; wins over both ignore files</h2>
        <p>
          A <code>&quot;files&quot;</code> array in <code>package.json</code> is an allowlist and is the safer default. But a root{" "}
          <code>.npmignore</code> or <code>.gitignore</code> can&apos;t exclude anything it includes. <code>&quot;files&quot;: [&quot;dist&quot;]</code>{" "}
          ships every file in <code>dist/</code>, including <code>*.map</code>, dotfiles like <code>dist/.env</code>, and anything else a build
          step dropped there. Negate inside the array if you need to:
        </p>
        <pre style={pre}><code>{`"files": ["dist", "!dist/**/*.map"]`}</code></pre>
        <p>
          Precedence, nested ignore files, and what npm always adds or drops: <a href="/guides/package-json-files">package.json &quot;files&quot;, tested</a>.
        </p>

        <h2>4. Source maps carry your source</h2>
        <p>
          Most bundlers write <code>sourcesContent</code> into maps by default (esbuild does; TypeScript does with <code>inlineSources</code>).
          That field holds the full pre-build source of every input file. For an open-source package it&apos;s dead weight. For a closed-source
          SDK or CLI it&apos;s the codebase, comments included. In our <a href="/report/npm-tarball-audit-2026">audit of popular packages</a> a
          large share ship maps and a meaningful fraction inline the source. Per-bundler fix: <a href="/guides/source-maps-npm">source maps in npm packages</a>.
        </p>

        <h2>5. Check before you publish</h2>
        <p>List exactly what would ship, without publishing:</p>
        <pre style={pre}><code>{`npm pack --dry-run --json | jq -r '.[0].files[].path'

# quick grep for the usual suspects
npm pack --dry-run --json | jq -r '.[0].files[].path' \\
  | grep -E '(^|/)\\.env|\\.map$|\\.pem$|id_rsa|\\.npmrc|coverage/|\\.sqlite'`}</code></pre>
        <p>
          That catches filenames. It won&apos;t catch a Stripe key pasted into a fixture or a token baked into <code>dist/</code> by a build-time
          env var. For that you have to read file contents, which is what ReleaseShield does: it unpacks the tarball and runs secret patterns
          and sensitive-file rules over every byte that would ship.
        </p>

        <h2>Fix order if something leaked</h2>
        <p>
          Short version below. Full walkthrough, including how to find every affected version and npm&apos;s unpublish limits:{" "}
          <a href="/guides/leaked-secret-npm-publish">published a secret to npm</a>.
        </p>
        <ol>
          <li>Rotate the credential first. Unpublishing doesn&apos;t help: mirrors and caches already have the tarball.</li>
          <li>
            Switch to a <code>&quot;files&quot;</code> allowlist, or put every <code>.gitignore</code> line you still need into{" "}
            <code>.npmignore</code>.
          </li>
          <li>Publish a patch version and deprecate the leaky one with <code>npm deprecate</code>.</li>
          <li>Add the dry-run check (or a scanner) to the publish job so it fails before it ships next time.</li>
        </ol>

        <h2>Check yours</h2>
        <p>
          <a href="/?ref=guide-npmignore#check">Scan any published package or upload a tarball</a>, free, no login. Or{" "}
          <a href="/docs">fail the publish in CI</a> when a new file or secret shows up.
        </p>
      </main>
    </>
  );
}
