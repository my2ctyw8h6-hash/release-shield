import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { SITE_URL } from "@/lib/reports";

const PATH = "/guides/package-json-files";

export const metadata: Metadata = {
  title: "package.json \"files\": what npm publish actually includes",
  description:
    "How the package.json files allowlist works in npm 10: what's always included, what's always dropped, why \"files\": [\"dist\"] still ships dist/.env and source maps, and which ignore files still apply.",
  alternates: { canonical: `${SITE_URL}${PATH}` },
};

const pre = { overflowX: "auto" as const };

export default function PackageJsonFiles() {
  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <Logo />
          <nav>
            <a href="/npm">Package reports</a>
            <a href="/docs">Docs</a>
            <a href={`/?ref=guide-files#check`} className="btn btn-sm btn-primary">Scan a package</a>
          </nav>
        </div>
      </header>
      <main className="docs container">
        <h1>package.json &quot;files&quot;: what npm publish actually includes</h1>
        <p className="muted">
          Everything below was checked with <code>npm pack --dry-run --json</code> on npm 10.9.9. Older npm versions differ in places
          (CHANGELOG used to be auto-included).
        </p>

        <h2>1. It&apos;s an allowlist, with a few exceptions</h2>
        <p>
          When <code>&quot;files&quot;</code> is present, only the paths it matches go in the tarball. npm adds a few on its own and drops a few on
          its own:
        </p>
        <ul>
          <li>
            <strong>Always in:</strong> <code>package.json</code>, <code>README*</code>, <code>LICENSE*</code>/<code>LICENCE*</code>, the
            file in <code>&quot;main&quot;</code>, and every file in <code>&quot;bin&quot;</code>.
          </li>
          <li>
            <strong>Always out:</strong> <code>.git</code>, <code>node_modules</code> (unless bundled), <code>.npmrc</code>,{" "}
            <code>package-lock.json</code>, <code>.DS_Store</code>, <code>npm-debug.log</code>.
          </li>
        </ul>
        <p>
          <code>&quot;files&quot;: []</code> ships <code>package.json</code> plus whatever matches the always-in list. Not CHANGELOG, not{" "}
          <code>src/</code>.
        </p>

        <h2>2. &quot;dist&quot; means everything in dist, dotfiles included</h2>
        <p>
          This is the one that bites. A directory entry pulls in the whole tree, and dotfiles aren&apos;t special. Real result from a test
          package with <code>&quot;files&quot;: [&quot;dist&quot;]</code>:
        </p>
        <pre style={pre}><code>{`$ ls -A dist
.env  a.js  a.js.map  sub/

$ npm pack --dry-run --json | jq -r '.[0].files[].path'
LICENSE
README.md
cli.js            # from "bin"
dist/.env         # <- shipped
dist/a.js
dist/a.js.map     # <- shipped
dist/sub/b.js
dist/sub/b.js.map
index.js          # from "main"
package.json`}</code></pre>
        <p>
          Build tools that copy <code>.env</code> into the output folder, write <code>*.map</code> next to every file, or leave a{" "}
          <code>stats.json</code>/<code>meta.json</code> behind all end up published. The allowlist only protects you from files outside{" "}
          <code>dist/</code>.
        </p>

        <h2>3. Negate inside the array</h2>
        <pre style={pre}><code>{`"files": [
  "dist",
  "!dist/**/*.map",
  "!dist/**/.env*"
]`}</code></pre>
        <p>
          Order matters. Put negations after the entry they trim: <code>[&quot;!dist/**/*.map&quot;, &quot;dist&quot;]</code> ships every map.
          In the test above, the first negation dropped the maps. <code>.env</code> and <code>.env.local</code> stayed until the second one
          was added.
        </p>

        <h2>4. Which ignore files still count</h2>
        <ul>
          <li>
            <strong>Root</strong> <code>.npmignore</code> / <code>.gitignore</code>: ignored for anything <code>&quot;files&quot;</code>{" "}
            includes. Putting <code>dist/a.js</code> in a root <code>.npmignore</code> did nothing.
          </li>
          <li>
            <strong>Nested</strong> ignore files inside an included directory: still applied. A <code>dist/.npmignore</code> or{" "}
            <code>dist/.gitignore</code> listing a file kept it out.
          </li>
        </ul>
        <p>
          So you can trim from inside <code>dist/</code>, but most build tools wipe that folder on every build, ignore file included. Negations
          in <code>package.json</code> survive a clean build. Use those.
        </p>

        <h2>5. Patterns, briefly</h2>
        <ul>
          <li>
            <code>&quot;dist&quot;</code> and <code>&quot;dist/&quot;</code> behave the same: whole tree.
          </li>
          <li>
            <code>&quot;dist/*.js&quot;</code> is one level only. Use <code>&quot;dist/**/*.js&quot;</code> for nested output.
          </li>
          <li>
            A typo matches nothing and npm doesn&apos;t warn. You find out when a user gets <code>Cannot find module</code>.
          </li>
        </ul>

        <h2>6. Check it on every publish</h2>
        <pre style={pre}><code>{`# what would ship, nothing published
npm pack --dry-run --json | jq -r '.[0].files[].path'

# fail the publish on the usual suspects
"scripts": {
  "prepublishOnly": "npm pack --dry-run --json | jq -r '.[0].files[].path' | (! grep -E '(^|/)\\\\.env|\\\\.map$|\\\\.pem$|id_rsa|coverage/')"
}`}</code></pre>
        <p>
          That catches filenames. It won&apos;t catch an API key a bundler inlined into <code>dist/index.js</code> from{" "}
          <code>process.env</code> at build time. ReleaseShield unpacks the tarball and runs secret patterns over the contents of every file
          that would ship. The same scan runs in CI via the CLI or the GitHub Action (<a href="/docs">docs</a>).
        </p>

        <h2>Related</h2>
        <ul>
          <li>
            <a href="/guides/npmignore-trap">The .npmignore trap</a>: what happens when you don&apos;t use <code>&quot;files&quot;</code>.
          </li>
          <li>
            <a href="/guides/source-maps-npm">Source maps in npm packages</a>: turning them off per bundler.
          </li>
          <li>
            <a href="/guides/leaked-secret-npm-publish">Published a secret to npm</a>: what to do, in order.
          </li>
        </ul>

        <h2>Check yours</h2>
        <p>
          <a href="/?ref=guide-files#check">Scan any published package or upload a tarball</a>, free, no login.
        </p>
      </main>
    </>
  );
}
