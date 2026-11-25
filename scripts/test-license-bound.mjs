#!/usr/bin/env node
// Item 14 test — bound the license offline-grace (C29).
// Part A: token logic with a throwaway keypair (expiry, tamper, missing exp).
// Part B: CLI end-to-end with the real server key (never printed) against a
// stub verify server on localhost, covering verified / offline-grace /
// 72h fail-closed / expired-token / cached-token fallback / fresh-token persist.
// Run: npm run build:cli && node scripts/test-license-bound.mjs
import { generateKeyPairSync, createPrivateKey, sign } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const esbuild = require(join(root, "node_modules", "esbuild"));

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const now = () => Math.floor(Date.now() / 1000);

// ---------- Part A: token logic with a throwaway keypair ----------
const { publicKey: testPub, privateKey: testPriv } = generateKeyPairSync("ed25519");
const testPubPem = testPub.export({ type: "spki", format: "pem" });
const testPrivDer = testPriv.export({ type: "pkcs8", format: "der" }).toString("base64");

const entry = "/tmp/item14-test-entry.ts";
writeFileSync(
  entry,
  `export { verifyLicenseToken, verifyLicenseTokenDetailed, decodeLicensePayload, LICENSE_TTL_SECONDS } from "${join(root, "lib", "license")}";
export { signLicenseToken } from "${join(root, "lib", "license-server")}";
`,
);
writeFileSync("/tmp/item14-empty.mjs", "export {};\n");
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "/tmp/item14-test-bundle.mjs",
  alias: { "server-only": "/tmp/item14-empty.mjs" },
  logLevel: "silent",
});
const lib = await import("/tmp/item14-test-bundle.mjs");
process.env.LICENSE_PRIVATE_KEY = testPrivDer;

const mintRaw = (payload) => {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  return `rs_${body}.${b64url(sign(null, Buffer.from(body), testPriv))}`;
};
const basePayload = (over = {}) => ({
  v: 1, sub: "sub_test_item14", cus: "cus_test", plan: "pro",
  email: "test@example.com", iat: now(), iss: "https://releaseshield.lineanswered.com", ...over,
});

check("TTL is 30 days", lib.LICENSE_TTL_SECONDS === 30 * 24 * 3600);
const fresh = lib.signLicenseToken(basePayload());
const freshDecoded = lib.decodeLicensePayload(fresh);
check("signLicenseToken sets exp = iat + 30d", freshDecoded?.exp === freshDecoded?.iat + 30 * 24 * 3600);
check("fresh token verifies", lib.verifyLicenseToken(fresh, testPubPem)?.plan === "pro");
const expired = mintRaw(basePayload({ iat: now() - 40 * 24 * 3600, exp: now() - 10 * 24 * 3600 }));
check("expired token rejected", lib.verifyLicenseToken(expired, testPubPem) === null);
check("expired token reason is expired", lib.verifyLicenseTokenDetailed(expired, testPubPem).reason === "expired");
const noExp = mintRaw({ v: 1, sub: "sub_test_item14", plan: "pro", iat: now(), iss: "https://releaseshield.lineanswered.com" });
check("token without exp rejected", lib.verifyLicenseToken(noExp, testPubPem) === null);
check("token without exp reads as expired", lib.verifyLicenseTokenDetailed(noExp, testPubPem).reason === "expired");
const tampered = fresh.slice(0, 20) + (fresh[20] === "A" ? "B" : "A") + fresh.slice(21);
check("tampered token rejected", lib.verifyLicenseToken(tampered, testPubPem) === null);
check("tampered token reason is invalid", lib.verifyLicenseTokenDetailed(tampered, testPubPem).reason === "invalid");
check("wrong-key token rejected", lib.verifyLicenseToken(fresh) === null, "fresh token is test-key signed; embedded key differs");

// ---------- Part B: CLI end-to-end with the real server key ----------
const cliBin = join(root, "cli", "dist", "releaseshield.mjs");
if (!existsSync(cliBin)) {
  console.log("FAIL CLI bundle missing — run npm run build:cli first");
  process.exit(1);
}
const envFile = process.env.LICENSE_TEST_ENV_FILE ?? "/root/factory/.env";
const envText = readFileSync(envFile, "utf8");
const realPrivDer = (envText.match(/^LICENSE_PRIVATE_KEY=(.+)$/m) || [])[1]?.trim();
if (!realPrivDer) {
  console.log("FAIL no LICENSE_PRIVATE_KEY in env file");
  process.exit(1);
}
const realPriv = createPrivateKey({ key: Buffer.from(realPrivDer, "base64"), format: "der", type: "pkcs8" });
const mintReal = (payload) => {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  return `rs_${body}.${b64url(sign(null, Buffer.from(body), realPriv))}`;
};

// Stub verify server: mode flips per scenario.
let stubMode = "valid";
let stubFreshToken = null;
const stub = createServer((req, res) => {
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    if (stubMode === "valid") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ valid: true, plan: "pro", status: "active", ...(stubFreshToken ? { token: stubFreshToken } : {}) }));
    } else if (stubMode === "inactive") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ valid: false, reason: "subscription_inactive", status: "canceled" }));
    } else {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "down" }));
    }
  });
});
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
const stubUrl = `http://127.0.0.1:${stub.address().port}`;

const runCli = (token, cacheDir, extraEnv = {}) =>
  // Async spawn (NOT spawnSync): the stub verify server lives on this
  // process's event loop, so a blocking spawn would deadlock the server.
  new Promise((resolve) => {
    const child = spawn("node", [cliBin, "license"], {
      env: {
        ...process.env,
        RELEASESHIELD_TOKEN: token ?? "",
        XDG_CACHE_HOME: cacheDir,
        RELEASESHIELD_API_URL: stubUrl,
        ...extraEnv,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });

const sub = "sub_item14_e2e";
const iss = stubUrl;
const freshReal = mintReal({ v: 1, sub, plan: "pro", email: "e2e@example.com", iat: now(), exp: now() + 30 * 24 * 3600, iss });

// B1: online verify -> verified, state file written.
const cache1 = mkdtempSync(join(tmpdir(), "rs-cache1-"));
stubMode = "valid";
let r = await runCli(freshReal, cache1);
check("B1 verified online", r.status === 0 && /status: verified/.test(r.stdout) && /plan:\s+pro/.test(r.stdout), r.stdout.trim().replace(/\n/g, " | "));
const state1 = JSON.parse(readFileSync(join(cache1, "releaseshield", "license-state.json"), "utf8"));
check("B1 state file has lastVerifiedAt", Math.abs((state1.lastVerifiedAt ?? 0) - now()) <= 120);

// B2: server down, fresh state -> offline-grace, exit 0.
stubMode = "down";
r = await runCli(freshReal, cache1);
check("B2 offline-grace within 72h", r.status === 0 && /status: offline-grace/.test(r.stdout), r.stdout.trim().replace(/\n/g, " | "));

// B3: server down, lastVerifiedAt 30h ago -> grace with escalated message.
const cache3 = mkdtempSync(join(tmpdir(), "rs-cache3-"));
mkdirSync(join(cache3, "releaseshield"), { recursive: true });
writeFileSync(join(cache3, "releaseshield", "license-state.json"), JSON.stringify({ token: freshReal, sub, lastVerifiedAt: now() - 30 * 3600 }));
r = await runCli(freshReal, cache3);
check("B3 grace escalates past 24h", r.status === 0 && /over a day/.test(r.stdout), r.stdout.trim().replace(/\n/g, " | "));

// B4: server down, lastVerifiedAt 100h ago -> fail closed to free, exit 1.
const cache4 = mkdtempSync(join(tmpdir(), "rs-cache4-"));
mkdirSync(join(cache4, "releaseshield"), { recursive: true });
writeFileSync(join(cache4, "releaseshield", "license-state.json"), JSON.stringify({ token: freshReal, sub, lastVerifiedAt: now() - 100 * 3600 }));
r = await runCli(freshReal, cache4);
check("B4 fail closed after 72h", r.status === 1 && /plan:\s+free/.test(r.stdout) && /72 hours/.test(r.stdout), r.stdout.trim().replace(/\n/g, " | "));

// B5: expired token, server down -> expired, exit 1.
const expiredReal = mintReal({ v: 1, sub, plan: "pro", email: "e2e@example.com", iat: now() - 40 * 24 * 3600, exp: now() - 10 * 24 * 3600, iss });
const cache5 = mkdtempSync(join(tmpdir(), "rs-cache5-"));
r = await runCli(expiredReal, cache5);
check("B5 expired token fails closed", r.status === 1 && /status: expired/.test(r.stdout) && /expired on/.test(r.stdout), r.stdout.trim().replace(/\n/g, " | "));

// B6: expired env token + valid cached token (same sub), server up -> verified via cache fallback.
const cache6 = mkdtempSync(join(tmpdir(), "rs-cache6-"));
mkdirSync(join(cache6, "releaseshield"), { recursive: true });
writeFileSync(join(cache6, "releaseshield", "license-state.json"), JSON.stringify({ token: freshReal, sub, lastVerifiedAt: now() - 3600 }));
stubMode = "valid";
r = await runCli(expiredReal, cache6);
check("B6 cached-token fallback verifies", r.status === 0 && /status: verified/.test(r.stdout), r.stdout.trim().replace(/\n/g, " | "));

// B7: server re-issues a fresh token; CLI persists it.
stubFreshToken = mintReal({ v: 1, sub, plan: "pro", email: "e2e@example.com", iat: now(), exp: now() + 30 * 24 * 3600, iss });
const cache7 = mkdtempSync(join(tmpdir(), "rs-cache7-"));
r = await runCli(freshReal, cache7);
const state7 = JSON.parse(readFileSync(join(cache7, "releaseshield", "license-state.json"), "utf8"));
check("B7 fresh server token persisted", r.status === 0 && state7.token === stubFreshToken, `cached token matches re-issued token: ${state7.token === stubFreshToken}`);

// B8: no token -> free/none, exit 0.
r = await runCli("", mkdtempSync(join(tmpdir(), "rs-cache8-")));
check("B8 no token is free/none", r.status === 0 && /status: none/.test(r.stdout));

stub.close();
console.log(failures === 0 ? "ALL ITEM-14 TESTS PASSED" : `${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
