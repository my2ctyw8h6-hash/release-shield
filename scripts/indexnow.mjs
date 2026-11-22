#!/usr/bin/env node
// Push sitemap URLs to IndexNow (Bing, Yandex, Seznam, Naver share submissions).
// Usage: node scripts/indexnow.mjs [--since-hours N] [--dry-run]
//   --since-hours N  only URLs whose <lastmod> is within N hours (URLs without lastmod are skipped)
// The key is public by design: it is served at /<key>.txt to prove host ownership.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SITE = (process.env.INDEXNOW_SITE ?? "https://releaseshield.lineanswered.com").replace(/\/$/, "");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const sinceIdx = args.indexOf("--since-hours");
const sinceHours = sinceIdx >= 0 ? Number(args[sinceIdx + 1]) : null;

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const keyFile = readdirSync(publicDir).find((f) => /^[a-f0-9]{32}\.txt$/.test(f));
if (!keyFile) throw new Error("no IndexNow key file in public/");
const key = keyFile.slice(0, -4);

const keyRes = await fetch(`${SITE}/${keyFile}`);
if (!keyRes.ok || (await keyRes.text()).trim() !== key) {
  console.error(`key file not live at ${SITE}/${keyFile} (status ${keyRes.status}); deploy first`);
  process.exit(1);
}

const xml = await (await fetch(`${SITE}/sitemap.xml`)).text();
const cutoff = sinceHours != null ? Date.now() - sinceHours * 3600_000 : null;
const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)]
  .map(([, block]) => ({
    loc: block.match(/<loc>([^<]+)<\/loc>/)?.[1],
    lastmod: block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1],
  }))
  .filter((u) => u.loc?.startsWith(SITE))
  .filter((u) => cutoff == null || (u.lastmod && Date.parse(u.lastmod) >= cutoff))
  .map((u) => u.loc);

if (urls.length === 0) {
  console.log("indexnow: nothing to submit");
  process.exit(0);
}
if (dryRun) {
  console.log(`indexnow dry-run: ${urls.length} URLs\n${urls.slice(0, 5).join("\n")}`);
  process.exit(0);
}

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: new URL(SITE).host, key, keyLocation: `${SITE}/${keyFile}`, urlList: urls.slice(0, 10000) }),
});
// 200 = accepted, 202 = accepted pending key validation; anything else is a failure.
console.log(`indexnow: submitted ${urls.length} URLs -> HTTP ${res.status}`);
if (res.status !== 200 && res.status !== 202) {
  console.error(await res.text());
  process.exit(1);
}
