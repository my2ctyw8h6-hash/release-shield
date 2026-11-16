import { Logo } from "@/components/Logo";
import { LeakChecker } from "@/components/LeakChecker";
import { PricingCards } from "@/components/PricingCards";
import { PLANS, toPublicPlan } from "@/lib/plans";
import { ACTION_REF } from "@/lib/site";

const CATCHES = [
  { t: "Source maps", d: "*.map files, especially ones with sourcesContent that rebuild your full original code." },
  { t: ".env & credentials", d: ".env, .npmrc auth tokens, .pypirc, service-account JSON, private keys." },
  { t: "Hard-coded secrets", d: "AWS, Stripe, GitHub, npm, Slack, OpenAI, Anthropic, Google and DB URLs." },
  { t: "Internal code & docs", d: "Roadmaps, internal/ folders, unreleased features, .git metadata." },
  { t: "Debug artifacts", d: "Logs, coverage output, database dumps, backups and editor files." },
  { t: "Infra fingerprints", d: "Internal hostnames, private IPs, Terraform state and CI config." },
];

const STEPS = [
  { n: "1", t: "Build", d: "Your pipeline runs npm pack, python -m build or docker build as usual." },
  { n: "2", t: "Unpack & inspect", d: "ReleaseShield opens the final artifact, exactly what users will download, and scans every file." },
  { n: "3", t: "Block or ship", d: "Critical findings fail the job before publish. Clean builds ship, with a report in the job summary." },
];

const FAQ = [
  {
    q: "How is this different from git secret scanners?",
    a: "Secret scanners look at your repository. Leaks happen in the build output: a bundler emits source maps, a stray .env sneaks into the package, a debug build is published. ReleaseShield inspects the artifact itself.",
  },
  {
    q: "Do you store my code?",
    a: "No. The free checker scans artifacts in memory and discards them. The CLI and GitHub Action run entirely on your own CI runner, so your code and scan results never reach our servers.",
  },
  {
    q: "Which registries are supported?",
    a: "npm tarballs, PyPI wheels and sdists, and Docker images (via docker save, so images pulled from any registry work). Pro can also fetch packages from private npm registries such as GitHub Packages and Artifactory.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Plans are month-to-month and billed through Stripe. Reply to any Stripe receipt to cancel and you won't be charged again.",
  },
];

export default function Home() {
  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <Logo />
          <nav>
            <a href="#how">How it works</a>
            <a href="#catches">What we catch</a>
            <a href="#pricing">Pricing</a>
            <a href="/docs">Docs</a>
            <a href="#check" className="btn btn-sm btn-primary">Free scan</a>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="container">
            <div className="eyebrow">Pre-publish leak scanner for npm · PyPI · Docker</div>
            <h1>
              One packaging mistake can <span className="grad">ship your entire codebase.</span>
            </h1>
            <p className="lede">
              Source maps, <code>.env</code> files, internal docs and debug builds get bundled into published packages every day.
              ReleaseShield inspects the <em>final artifact</em> in CI and blocks the release before it leaks.
            </p>
            <LeakChecker />
          </div>
        </section>

        <section className="section" id="how">
          <div className="container">
            <h2>Scan what you ship, not just what you commit</h2>
            <div className="grid-3">
              {STEPS.map((s) => (
                <div className="card step" key={s.n}>
                  <div className="step-n">{s.n}</div>
                  <h3>{s.t}</h3>
                  <p className="muted">{s.d}</p>
                </div>
              ))}
            </div>
            <pre className="code">
              <code>{`# .github/workflows/release.yml
- uses: actions/checkout@v4
- run: npm ci
- uses: ${ACTION_REF}
  with:
    fail-on: critical
    token: \${{ secrets.RELEASESHIELD_TOKEN }}
- run: npm publish

# …or anywhere:  npx releaseshield scan --fail-on critical`}</code>
            </pre>
          </div>
        </section>

        <section className="section alt" id="catches">
          <div className="container">
            <h2>What ReleaseShield catches</h2>
            <div className="grid-3">
              {CATCHES.map((c) => (
                <div className="card" key={c.t}>
                  <h3>{c.t}</h3>
                  <p className="muted">{c.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="pricing">
          <div className="container">
            <h2>Simple pricing for teams that ship</h2>
            <p className="muted center">A single leaked source map can cost more than a decade of ReleaseShield.</p>
            <PricingCards plans={[PLANS.standard, PLANS.pro].map(toPublicPlan)} />
          </div>
        </section>

        <section className="section alt">
          <div className="container narrow">
            <h2>FAQ</h2>
            {FAQ.map((f) => (
              <details className="faq" key={f.q}>
                <summary>{f.q}</summary>
                <p className="muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="container footer-inner">
          <Logo />
          <span className="muted small">© {new Date().getFullYear()} ReleaseShield. Ship code, not secrets.</span>
        </div>
      </footer>
    </>
  );
}
