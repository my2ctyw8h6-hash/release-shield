import type { TarEntry } from "./tar";

/**
 * A fake "leaky" npm package, built in memory for the homepage demo scan.
 * Never published, never written to disk. Every secret is a documented example
 * or obviously fake value; they're assembled from pieces so this source file
 * doesn't set off secret scanners (GitHub push protection, ReleaseShield itself).
 */
export const SAMPLE_NAME = "acme-billing-sdk";
export const SAMPLE_VERSION = "2.4.1";

const j = (...parts: string[]) => parts.join("");

// AWS's documented example key ID: the scanner's placeholder filter skips it (no false positive). The rest are fake but realistic-shaped.
const AWS_ID = j("AKIA", "IOSFODNN7", "EXAMPLE");
const STRIPE = j("sk_", "live_", "51DEMOxNOTxAxREALxKEY00000");
const NPM_TOKEN = j("npm_", "DEMO0NOT0A0REAL0TOKEN0000000000000000");
const PEM_HEAD = j("-----BEGIN ", "RSA PRIVATE KEY", "-----");
const PEM_TAIL = j("-----END ", "RSA PRIVATE KEY", "-----");

const FILES: Record<string, string> = {
  "package/package.json": JSON.stringify({ name: SAMPLE_NAME, version: SAMPLE_VERSION, main: "dist/index.js" }, null, 2),
  "package/README.md": "# acme-billing-sdk\n\nDemo package for ReleaseShield. Not real.\n",
  "package/dist/index.js": "\"use strict\";\nexports.charge = function charge() { return fetch(\"http://billing.acme.internal/v1/charge\"); };\n",
  "package/dist/index.js.map": JSON.stringify({ version: 3, sources: ["../src/index.ts"], mappings: "AAAA" }),
  "package/.env": `AWS_ACCESS_KEY_ID=${AWS_ID}\nSTRIPE_SECRET_KEY=${STRIPE}\nDATABASE_URL=postgres://billing:hunter2demo@db.acme.internal:5432/billing\n`,
  "package/.npmrc": `//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n`,
  "package/deploy/id_rsa": `${PEM_HEAD}\nDEMO-NOT-A-REAL-KEY\n${PEM_TAIL}\n`,
  "package/fixtures/customers.sqlite": "SQLite format 3 (demo placeholder)",
  "package/npm-debug.log": "0 info it worked if it ends with ok\n1 verbose cli /Users/dev/acme/node_modules/.bin/npm\n",
  "package/.vscode/settings.json": "{}\n",
};

export function sampleEntries(): TarEntry[] {
  return Object.entries(FILES).map(([path, text]) => {
    const data = Buffer.from(text);
    return { path, size: data.length, data };
  });
}
