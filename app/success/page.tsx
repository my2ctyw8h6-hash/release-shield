import type { Metadata } from "next";
import { headers } from "next/headers";
import { Logo } from "@/components/Logo";
import { CopyBox } from "@/components/CopyBox";
import { PLANS, isPlanId } from "@/lib/plans";
import { issueLicenseForSession } from "@/lib/stripe";
import { ACTION_REF, configuredSiteUrl } from "@/lib/site";

export const metadata: Metadata = { title: "Welcome to ReleaseShield", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

async function siteUrl(): Promise<string> {
  const configured = configuredSiteUrl();
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function Success({ searchParams }: { searchParams: Promise<{ plan?: string; session_id?: string }> }) {
  const { plan, session_id } = await searchParams;
  const license = session_id ? await issueLicenseForSession(session_id, await siteUrl()) : null;
  const planId = license?.ok ? license.plan : isPlanId(plan) ? plan : null;
  const name = planId ? PLANS[planId].name : null;

  const workflow = `- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with: { node-version: 22 }
- run: npm ci
- uses: ${ACTION_REF}
  with:
    fail-on: critical
    token: \${{ secrets.RELEASESHIELD_TOKEN }}
- run: npm publish`;

  return (
    <main className="success">
      <div className="card success-card wide">
        <Logo />
        <h1>{license && !license.ok ? "Almost there: we need to confirm your checkout" : <>You&apos;re protected{name ? ` on ${name}` : ""} 🎉</>}</h1>

        {license?.ok ? (
          <>
            <p className="muted">
              Your subscription is active. This is your license token. Treat it like a password.
              {license.email ? ` It's tied to ${license.email}.` : ""} You can come back to this page any time to see it again.
            </p>
            <CopyBox value={license.token} label="License token" />
          </>
        ) : license ? (
          <div className="alert">
            {license.message} If you were charged, reply to your Stripe receipt and we&apos;ll send your license token manually.
          </div>
        ) : (
          <p className="muted">Thanks for subscribing! Your license token will arrive by email shortly.</p>
        )}

        <ol className="success-steps">
          <li>
            Add the token as a CI secret named <code>RELEASESHIELD_TOKEN</code>.
          </li>
          <li>Add the scan step before your publish step:</li>
        </ol>
        <pre className="code left">
          <code>{workflow}</code>
        </pre>
        <p className="muted small">
          Or run it anywhere: <code>RELEASESHIELD_TOKEN=… npx releaseshield scan --fail-on critical</code>
        </p>
        <div className="row-gap">
          <a className="btn btn-primary" href="/docs">Read the setup guide</a>
          <a className="btn btn-ghost" href="/">Back to ReleaseShield</a>
        </div>
      </div>
    </main>
  );
}
