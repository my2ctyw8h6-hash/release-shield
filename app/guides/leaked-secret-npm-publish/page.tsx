import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { SITE_URL } from "@/lib/reports";

const PATH = "/guides/leaked-secret-npm-publish";
const REF = "guide-leaked";

export const metadata: Metadata = {
  title: "Published a .env or API key to npm? What to do, in order",
  description:
    "You ran npm publish and the tarball had a .env, token or private key in it. Rotate first, find every affected version, what npm unpublish will and won't let you do, and how to stop it happening again.",
  alternates: { canonical: `${SITE_URL}${PATH}` },
};

const pre = { overflowX: "auto" as const };

export default function LeakedSecretNpmPublish() {
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
        <h1>You published a secret to npm. Do this, in this order.</h1>
        <p className="muted">
          A <code>.env</code>, an <code>.npmrc</code> with a token, a private key, or a key baked into <code>dist/</code> went out with{" "}
          <code>npm publish</code>. Here&apos;s the order that matters.
        </p>

        <h2>1. Rotate the credential now</h2>
        <p>
          Assume it&apos;s already copied. Registry mirrors and CDNs (unpkg, jsDelivr, npmmirror) fetch new tarballs within minutes, and
          people do scrape new releases for keys. Unpublishing doesn&apos;t un-leak anything, so revoke and reissue before you touch npm:
        </p>
        <ul>
          <li>npm token: <code>npm token list</code>, then <code>npm token revoke &lt;id&gt;</code></li>
          <li>GitHub token: Settings → Developer settings → revoke it, then check the audit log</li>
          <li>AWS key: deactivate and delete it in IAM, then check CloudTrail for calls you didn&apos;t make</li>
          <li>Stripe, OpenAI, database URLs, webhook secrets: roll them in the provider dashboard</li>
        </ul>
        <p>Once the old value is dead, the rest is cleanup.</p>

        <h2>2. Find every version that has it</h2>
        <p>
          The file is rarely in just the latest release. Check every published version. This pulls each tarball from the registry and
          looks for the filename, or for the leaked value itself:
        </p>
        <pre style={pre}><code>{`pkg=your-package
needle='\\.env'          # filename regex, e.g. '\\.env|\\.npmrc|id_rsa'
value='sk_live_abc123'  # or the leaked value itself (optional)

for v in $(npm view "$pkg" versions --json | jq -r 'if type=="array" then .[] else . end'); do
  tgz=$(npm pack "$pkg@$v" --silent 2>/dev/null) || continue
  if tar -tzf "$tgz" | grep -qE "(^|/)($needle)"; then echo "$v: file"; fi
  if [ -n "$value" ] && tar -xzOf "$tgz" | grep -qF "$value"; then echo "$v: value"; fi
  rm -f "$tgz"
done`}</code></pre>
        <p>
          Filename matching misses keys that a build step inlined into a bundle (for example <code>process.env.X</code> replaced at build
          time). Grepping for the value catches that, but only if you know the value. To find secrets you don&apos;t know about,{" "}
          <a href={`/?ref=${REF}#check`}>scan the published package</a>. It reads every file in the tarball, not just the names.
        </p>

        <h2>3. Unpublish, if npm will let you</h2>
        <p>npm&apos;s unpublish policy is strict. You can remove a version yourself only if:</p>
        <ul>
          <li>it was published less than 72 hours ago, <strong>or</strong></li>
          <li>
            no other public package depends on it, it had fewer than 300 downloads in the last week, and it has a single owner/maintainer
          </li>
        </ul>
        <pre style={pre}><code>{`npm unpublish your-package@1.4.2`}</code></pre>
        <p>
          You can never reuse that version number. If you unpublish every version, the name is blocked for 24 hours. When the policy says no,
          npm support can still remove a version that contains a secret. Open a ticket at npmjs.com/support with the package, versions and
          what leaked. Rotate first anyway: removal can take days.
        </p>

        <h2>4. Ship a clean patch and deprecate the bad range</h2>
        <pre style={pre}><code>{`# fix packaging (step 5), then
npm version patch && npm publish

# warn anyone still installing a leaky version
npm deprecate "your-package@<1.4.3" "contained a leaked credential (rotated); upgrade to 1.4.3+"`}</code></pre>
        <p>
          A deprecated version stays installable, but npm prints a warning on every install. Most people pin with <code>^</code>, so they pick up the
          patch on their next install anyway.
        </p>

        <h2>5. Fix why it shipped</h2>
        <p>Almost always one of these:</p>
        <ul>
          <li>
            A <code>.npmignore</code> exists, so npm stopped reading <code>.gitignore</code> and your gitignored <code>.env</code> was back
            in scope. Details: <a href="/guides/npmignore-trap">the .npmignore trap</a>.
          </li>
          <li>
            <code>&quot;files&quot;: [&quot;dist&quot;]</code> and something wrote a secret or source map into <code>dist/</code>. The{" "}
            <code>files</code> allowlist beats both ignore files. See <a href="/guides/source-maps-npm">source maps in npm packages</a>.
          </li>
          <li>
            Publishing from a laptop or a CI workspace with leftovers. npm packs the working directory, not the git commit, so files that were
            never committed still ship.
          </li>
        </ul>
        <p>
          Switch to a <code>&quot;files&quot;</code> allowlist, then check the result before every publish with{" "}
          <code>npm pack --dry-run</code>.
        </p>

        <h2>6. Make the next one fail in CI</h2>
        <p>
          A dry-run list only helps if someone reads it. Gate the publish job instead. ReleaseShield runs <code>npm pack</code>, unpacks the
          tarball and fails the step on secrets or sensitive files before <code>npm publish</code> runs:
        </p>
        <pre style={pre}><code>{`curl -fsSLo releaseshield.mjs ${SITE_URL}/releaseshield.mjs
node releaseshield.mjs scan`}</code></pre>
        <p>
          The GitHub Action setup is in <a href="/docs">the docs</a>. To check what&apos;s already out there,{" "}
          <a href={`/?ref=${REF}#check`}>scan any published package</a>. It&apos;s free and needs no login.
        </p>
      </main>
    </>
  );
}
