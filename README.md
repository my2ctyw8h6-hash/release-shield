# ReleaseShield

A pre-publish leak scanner for npm, PyPI and Docker artifacts. Built with Next.js 16 (App Router) and Stripe.

## Features
- **Free public leak checker** on the homepage. Scan any npm package (by name) or upload an `npm pack` tarball (≤4 MB). Files are scanned in memory and never stored.
  Detects: `.env` files, private keys, credential files, source maps (including embedded `sourcesContent`), `.git` metadata, DB dumps, internal docs, logs, backups, and hard-coded secrets (AWS, Stripe, GitHub, npm, Slack, OpenAI, Anthropic, Google, DB URLs, JWTs).
- **Lead capture**: the first 3 findings are free, and the rest unlock with an email. Leads go to `LEAD_WEBHOOK_URL` (if set) and to `data/leads.jsonl` on writable filesystems.
- **Paywall**: Standard ($19/mo, up to 5 packages/repos) and Pro / Team ($49/mo, unlimited packages/repos). `/api/checkout` uses `STRIPE_RESTRICTED_KEY` on the server only to find or create the Product, the monthly Price (by `lookup_key`) and an active **Stripe Payment Link**, then redirects the buyer to it. Links are reused, not duplicated. Plans live in `lib/plans.ts`: change `priceMonthly` there and the next checkout creates a new Stripe Price on the same Product, moves the lookup key to it, and deactivates Payment Links that still sell the old price.

- **CLI** (`cli/`): `npx releaseshield scan`. Scans npm tarballs, Python wheels/sdists and Docker images (`docker save`), with text/JSON/SARIF/Markdown output, `--fail-on` enforcement, Slack alerts, policies and release diffs. It's a single dependency-free bundle in `cli/dist/releaseshield.mjs`.
- **GitHub Action** (`action.yml` at the repo root + `action/dist/index.mjs`): wraps the CLI and adds inline annotations, a job summary, SARIF and step outputs.
- **Licensing**: after checkout, `/success?session_id=…` verifies the Stripe Checkout Session and shows a signed license token (Ed25519). The CLI checks the signature offline with the public key in `lib/license-public-key.ts`, then calls `/api/license/verify` to confirm the subscription is still active. It fails open if the server is unreachable.
- **Docs** at `/docs`.

## Layout
| Path | What |
| --- | --- |
| `app/` | Next.js site + API routes (`/api/scan`, `/api/lead`, `/api/checkout`, `/api/license/verify`) |
| `lib/` | Shared scan engine (tar/zip/docker readers, rules), npm client, Stripe + license helpers |
| `cli/src`, `cli/dist` | CLI source and committed bundle (publish `cli/` to npm as `releaseshield`) |
| `action/src`, `action/dist`, `action.yml` | GitHub Action source and committed bundle |
| `scripts/` | `build-cli.mjs` (esbuild bundler) and `license-keygen.mjs` |

## Setup
```bash
npm install
cp .env.example .env.local   # locally this is a symlink to ../.env
npm run dev                  # http://localhost:3000
npm run build && npm start      # build bundles the CLI + Action first, then Next.js
npm run license:keygen          # one-time: creates LICENSE_PRIVATE_KEY + lib/license-public-key.ts
```

Publishing:
- **CLI**: `cd cli && npm publish`. It's already bundled by `npm run build`.
- **Action**: push this repo to GitHub, tag `v1`, and set `NEXT_PUBLIC_GITHUB_ACTION_REF` (default `releaseshield/release-shield@v1`) to `<owner>/<repo>@v1` so the site's snippets match. Optionally list it on the Marketplace.

### Environment variables
| Var | Required | Notes |
| --- | --- | --- |
| `STRIPE_RESTRICTED_KEY` | yes | `rk_live_…`/`rk_test_…` with **write** on Products, Prices, Payment Links and **read** on Checkout Sessions, Subscriptions |
| `LICENSE_PRIVATE_KEY` | yes | Ed25519 private key (base64 PKCS#8) for signing license tokens. Generate with `npm run license:keygen`. Rotating it invalidates issued tokens. |
| `NEXT_PUBLIC_GITHUB_ACTION_REF` | optional | Action reference shown in snippets, e.g. `acme/release-shield@v1` |
| `NEXT_PUBLIC_SITE_URL` | recommended | Public https URL; becomes the post-payment redirect (`/success`). Without it, Stripe shows its own confirmation page. |
| `LEAD_WEBHOOK_URL` | optional | Receives each lead as JSON POST |
| `STRIPE_PAYMENT_LINK_STANDARD` / `_PRO` | optional | Use pre-made links instead of API creation |

## Deploy (Vercel)
1. Import the `release-shield` folder as the project root.
2. Add the env vars above in Project Settings → Environment Variables.
3. Deploy. Every route is either static or a Node.js serverless function.
