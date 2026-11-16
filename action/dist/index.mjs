// action/src/index.ts
import { appendFileSync, writeFileSync } from "node:fs";
import path3 from "node:path";

// cli/src/core.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import path2 from "node:path";

// lib/tar.ts
import { gunzipSync } from "node:zlib";
var BLOCK = 512;
function readString(buf, start, len) {
  const slice = buf.subarray(start, start + len);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul === -1 ? slice.length : nul).toString("utf8");
}
function readOctal(buf, start, len) {
  const raw = readString(buf, start, len).trim();
  if (!raw) return 0;
  const n = parseInt(raw, 8);
  return Number.isFinite(n) ? n : 0;
}
function parsePax(data) {
  const out = {};
  let i = 0;
  const text = data.toString("utf8");
  while (i < text.length) {
    const space = text.indexOf(" ", i);
    if (space === -1) break;
    const len = parseInt(text.slice(i, space), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const record = text.slice(space + 1, i + len - 1);
    const eq = record.indexOf("=");
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    i += len;
  }
  return out;
}
function extractTar(input2, opts) {
  let buf = input2;
  if (buf.length > 2 && buf[0] === 31 && buf[1] === 139) {
    buf = gunzipSync(buf, { maxOutputLength: opts.maxUnpackedBytes });
  }
  const entries = [];
  let offset = 0;
  let longName = null;
  let paxPath = null;
  while (offset + BLOCK <= buf.length) {
    const header = buf.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) break;
    let name = readString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const magic = readString(header, 257, 6);
    if (magic.startsWith("ustar")) {
      const prefix = readString(header, 345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > buf.length) throw new Error("Corrupt or truncated tar archive");
    const data = buf.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;
    if (type === "L") {
      longName = readString(data, 0, data.length);
      continue;
    }
    if (type === "x") {
      paxPath = parsePax(data).path ?? null;
      continue;
    }
    if (type === "g") continue;
    const path4 = paxPath ?? longName ?? name;
    longName = null;
    paxPath = null;
    if (type === "0" || type === "\0" || type === "7") {
      entries.push({ path: path4, size, data });
      if (entries.length > opts.maxEntries) throw new Error(`Archive has more than ${opts.maxEntries} files`);
    }
  }
  return entries;
}

// lib/zip.ts
import { inflateRawSync } from "node:zlib";
function extractZip(buf, opts) {
  const EOCD = 101010256;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("Not a valid zip archive");
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  if (count === 65535 || ptr === 4294967295) throw new Error("zip64 archives are not supported");
  if (count > opts.maxEntries) throw new Error(`Archive has more than ${opts.maxEntries} files`);
  const entries = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(ptr) !== 33639248) throw new Error("Corrupt zip central directory");
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const size = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const path4 = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    ptr += 46 + nameLen + extraLen + commentLen;
    if (path4.endsWith("/")) continue;
    total += size;
    if (total > opts.maxUnpackedBytes) throw new Error("Archive too large when unpacked");
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
    else continue;
    entries.push({ path: path4, size, data });
  }
  return entries;
}

// lib/glob.ts
function globToRegExp(glob) {
  let g = glob.trim().replace(/^\.\//, "").replace(/^\//, "");
  if (g.endsWith("/")) g += "**";
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        i++;
        if (g[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}
function compileGlobs(globs) {
  const compiled = globs.filter(Boolean).map((g) => ({ re: globToRegExp(g), basenameOnly: !g.replace(/\/$/, "").includes("/") }));
  return (path4) => {
    const base = path4.split("/").pop() ?? path4;
    return compiled.some(({ re, basenameOnly }) => re.test(path4) || basenameOnly && (re.test(base) || path4.split("/").some((seg) => re.test(seg))));
  };
}

// lib/rules.ts
var envExample = /\.(example|sample|template|dist|defaults?)$/i;
var PATH_RULES = [
  {
    id: "env-file",
    title: "Environment file shipped",
    severity: "critical",
    test: (_p, b) => /^\.env(\..+)?$/i.test(b) && !envExample.test(b),
    advice: 'Add .env* to .npmignore or use an explicit "files" allowlist in package.json. Rotate every value in it.'
  },
  {
    id: "private-key-file",
    title: "Private key / certificate bundle",
    severity: "critical",
    // .pem/.crt are usually public certs; PEM private keys are caught by the content rule instead.
    test: (_p, b) => /\.(key|p12|pfx|jks|keystore|ppk)$/i.test(b) || /^id_(rsa|dsa|ecdsa|ed25519)$/i.test(b),
    advice: "Remove the key from the artifact and revoke/rotate it immediately."
  },
  {
    id: "credentials-file",
    title: "Credentials / auth config file",
    severity: "high",
    test: (_p, b) => /^(\.npmrc|\.pypirc|\.netrc|\.htpasswd|credentials(\.json)?|service-account.*\.json|\.dockercfg|config\.json\.bak)$/i.test(b),
    advice: "Registry and cloud auth files should never be published. Exclude them and rotate tokens."
  },
  {
    id: "source-map",
    title: "Source map published",
    severity: "medium",
    test: (_p, b) => /\.(js|mjs|cjs|css|ts)\.map$/i.test(b),
    advice: "Source maps expose original file names and structure, and can reconstruct source. Strip *.map from release builds or upload them privately to your error tracker."
  },
  {
    id: "git-dir",
    title: "Git metadata included",
    severity: "high",
    test: (p) => /(^|\/)\.git\//.test(p) || /(^|\/)\.git$/.test(p),
    advice: "A .git directory can expose full history, remotes and unreleased branches."
  },
  {
    id: "database-dump",
    title: "Database file or dump",
    severity: "high",
    test: (_p, b) => /\.(sqlite3?|db|sql|dump|bak\.sql)$/i.test(b),
    advice: "Database files frequently contain customer or internal data. Exclude them from releases."
  },
  {
    id: "internal-docs",
    title: "Internal documentation",
    severity: "medium",
    // Only documents. `src/internal/*.js` style code folders are normal in SDKs.
    test: (p, b) => /\.(md|mdx|txt|pdf|docx?|pptx?|xlsx?|rtf|html?)$/i.test(b) && !/^(README|LICEN[CS]E|CHANGELOG|HISTORY|NOTICE|CONTRIBUTING|SECURITY)(\.|$)/i.test(b) && /(^|\/)(internal|private|confidential|secret)s?(\/|[-_.])/i.test(p) || /^(ROADMAP|INTERNAL|TODO-internal)\.md$/i.test(b),
    advice: "Roadmaps and internal docs can reveal unreleased features. Keep them out of the package."
  },
  {
    id: "log-file",
    title: "Log file",
    severity: "medium",
    test: (_p, b) => /\.log$/i.test(b) || /^npm-debug\.log/i.test(b),
    advice: "Logs can contain tokens, file paths and stack traces from your build machine."
  },
  {
    id: "backup-file",
    title: "Backup / editor temp file",
    severity: "medium",
    test: (_p, b) => /(\.(bak|orig|old|swp|swo|tmp)|~)$/i.test(b),
    advice: "Backup files often hold stale secrets or unreviewed code."
  },
  {
    id: "archive-in-archive",
    title: "Nested archive",
    severity: "medium",
    test: (_p, b) => /\.(zip|tar|tgz|tar\.gz|7z|rar)$/i.test(b),
    advice: "Nested archives are often accidental build artifacts. Verify they are intended."
  },
  {
    id: "test-coverage",
    title: "Coverage / test output",
    severity: "low",
    test: (p) => /(^|\/)(coverage|\.nyc_output|__snapshots__|test-results)\//.test(p),
    advice: "Coverage output bloats the package and can embed full source."
  },
  {
    id: "ide-config",
    title: "IDE / OS metadata",
    severity: "low",
    test: (p, b) => /(^|\/)(\.vscode|\.idea)\//.test(p) || b === ".DS_Store" || b === "Thumbs.db",
    advice: "Editor and OS files leak local paths and usernames."
  },
  {
    id: "ci-config",
    title: "CI / infra configuration",
    severity: "low",
    test: (p, b) => /(^|\/)(\.github\/workflows|\.gitlab|\.circleci)\//.test(p) || /^\.gitlab-ci\.ya?ml$/.test(b) || /^(docker-compose.*\.ya?ml|terraform\.tfvars|.*\.tfstate)$/i.test(b),
    advice: "Infra config can reveal internal hostnames, account IDs and deployment topology."
  }
];
var CONTENT_RULES = [
  { id: "private-key", title: "Private key material", severity: "critical", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/, advice: "Revoke the key and remove it from source." },
  { id: "aws-key", title: "AWS access key ID", severity: "critical", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, advice: "Deactivate the key in IAM and audit CloudTrail." },
  { id: "stripe-key", title: "Stripe live secret key", severity: "critical", pattern: /\b(?:sk|rk)_live_[0-9a-zA-Z]{20,}\b/, advice: "Roll the key in the Stripe dashboard." },
  { id: "github-token", title: "GitHub token", severity: "critical", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/, advice: "Revoke the token at github.com/settings/tokens." },
  { id: "npm-token", title: "npm access token", severity: "critical", pattern: /\bnpm_[A-Za-z0-9]{36}\b/, advice: "Revoke the token with `npm token revoke`." },
  { id: "npmrc-auth", title: "Registry auth token", severity: "critical", pattern: /_authToken\s*=\s*[^\s$]{8,}/, advice: "Remove the token from .npmrc and revoke it." },
  { id: "slack-token", title: "Slack token", severity: "critical", pattern: /\bxox[abposr]-[0-9A-Za-z-]{10,}\b/, advice: "Revoke the token in your Slack app settings." },
  { id: "slack-webhook", title: "Slack webhook URL", severity: "high", pattern: /https:\/\/hooks\.slack\.com\/services\/T[0-9A-Z]+\/B[0-9A-Z]+\/[0-9A-Za-z]+/, advice: "Regenerate the webhook." },
  { id: "anthropic-key", title: "Anthropic API key", severity: "critical", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/, advice: "Delete the key in the Anthropic Console." },
  { id: "openai-key", title: "OpenAI API key", severity: "critical", pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20}T3BlbkFJ[A-Za-z0-9_-]{20,}|\bsk-proj-[A-Za-z0-9_-]{40,}/, advice: "Revoke the key in the OpenAI dashboard." },
  { id: "google-key", title: "Google API key", severity: "high", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/, advice: "Restrict or regenerate the key in Google Cloud Console." },
  { id: "db-url", title: "Database URL with password", severity: "high", pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/'"]+:[^\s@/'"]{3,}@[^\s'"]+/, advice: "Rotate the database password and load it from the environment." },
  { id: "jwt", title: "Hard-coded JWT", severity: "medium", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, advice: "Confirm the token is not a long-lived credential." },
  { id: "internal-host", title: "Internal hostname / private IP URL", severity: "low", pattern: /\b(?:https?|wss?|grpc|tcp):\/\/(?:(?:[a-z0-9-]+\.)+(?:internal|corp|lan)\b|(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3})/i, advice: "Internal endpoints help attackers map your infrastructure." }
];
var SEVERITY_WEIGHT = { critical: 40, high: 15, medium: 6, low: 2 };
var SEVERITY_ORDER = ["critical", "high", "medium", "low"];

// lib/scanner.ts
var DOCKER_DEFAULT_IGNORE = [
  "usr/share/**",
  "usr/lib/**",
  "usr/libexec/**",
  "usr/include/**",
  "lib/**",
  "lib64/**",
  "etc/ssl/**",
  "etc/pki/**",
  "etc/ca-certificates/**",
  "var/lib/dpkg/**",
  "var/lib/apt/**",
  "var/lib/rpm/**",
  "var/cache/**",
  "usr/local/lib/python*/test/**",
  "usr/local/lib/python*/site-packages/**/tests/**",
  "usr/local/lib/node_modules/npm/**",
  "usr/local/lib/node_modules/corepack/**",
  "opt/yarn*/**",
  "proc/**",
  "sys/**",
  "dev/**"
];
var LIMITS = {
  maxUnpackedBytes: 150 * 1024 * 1024,
  maxEntries: 2e4,
  maxTextScanBytes: 2 * 1024 * 1024,
  maxFindings: 200,
  maxContentHitsPerFile: 5
};
var TEST_PATH = /(^|\/)(tests?|__tests__|__mocks__|spec|fixtures?|examples?)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;
var PLACEHOLDER = /x{6,}|your[_-]?(api[_-]?)?(key|token|secret)|example|placeholder|dummy|<[^>]+>|\$\{|\{\{|%s|:(pass(word)?|secret|changeme|\*+)@/i;
function mask(value) {
  const v = value.trim();
  if (v.length <= 12) return `${v.slice(0, 3)}\u2026`;
  return `${v.slice(0, 6)}\u2026${v.slice(-4)} (${v.length} chars)`;
}
function isProbablyText(data) {
  const n = Math.min(data.length, 8e3);
  for (let i = 0; i < n; i++) if (data[i] === 0) return false;
  return true;
}
function normalizePath(path4) {
  return path4.replace(/^\.\//, "").replace(/^package\//, "");
}
function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}
function scanEntry(entry, findings, limits) {
  const file = normalizePath(entry.path);
  const base = file.split("/").pop() ?? file;
  for (const rule of PATH_RULES) {
    if (rule.test(file, base)) {
      findings.push({ ruleId: rule.id, title: rule.title, severity: rule.severity, file, advice: rule.advice });
    }
  }
  if (entry.size === 0 || entry.size > limits.maxTextScanBytes || !isProbablyText(entry.data)) return;
  const text = entry.data.toString("utf8");
  if (/\.map$/i.test(base) && /"sourcesContent"\s*:\s*\[\s*"/.test(text)) {
    const bare = findings.findIndex((f) => f.ruleId === "source-map" && f.file === file);
    if (bare !== -1) findings.splice(bare, 1);
    const m = text.match(/"sources"\s*:\s*\[([^\]]*)\]/);
    const n = m ? m[1].split(",").filter((s) => s.trim()).length : 0;
    findings.push({
      ruleId: "source-map-embedded",
      title: "Source map embeds full original source",
      severity: "critical",
      file,
      evidence: n ? `${n} original source file${n === 1 ? "" : "s"} recoverable` : "sourcesContent present",
      advice: "Anyone can rebuild your original, unminified source from this file. Remove it from the release."
    });
  }
  const isTestFile = TEST_PATH.test(file);
  let hits = 0;
  for (const rule of CONTENT_RULES) {
    if (hits >= limits.maxContentHitsPerFile) break;
    if (isTestFile && rule.severity !== "critical") continue;
    const match = rule.pattern.exec(text);
    if (!match) continue;
    if (PLACEHOLDER.test(match[0])) continue;
    hits++;
    findings.push({
      ruleId: rule.id,
      title: rule.title,
      severity: rule.severity,
      file,
      line: lineOf(text, match.index),
      evidence: rule.id === "private-key" ? match[0] : mask(match[0]),
      advice: rule.advice
    });
  }
}
var GROUP_THRESHOLD = 3;
function groupFindings(findings) {
  const byRule = /* @__PURE__ */ new Map();
  for (const f of findings) {
    const list2 = byRule.get(f.ruleId) ?? [];
    list2.push(f);
    byRule.set(f.ruleId, list2);
  }
  const out = [];
  for (const list2 of byRule.values()) {
    const isSecret = list2[0].line !== void 0;
    if (isSecret || list2.length <= GROUP_THRESHOLD) {
      out.push(...list2);
      continue;
    }
    const sample = list2.slice(0, 3).map((f) => f.file);
    out.push({
      ...list2[0],
      title: `${list2[0].title} (${list2.length} files)`,
      file: sample[0],
      evidence: `e.g. ${sample.join(", ")}${list2.length > 3 ? ` and ${list2.length - 3} more` : ""}`,
      occurrences: list2.length
    });
  }
  return out;
}
function grade(score) {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 55) return "C";
  if (score >= 35) return "D";
  return "F";
}
function readArchive(buf, limitsIn = {}) {
  const limits = { ...LIMITS, ...limitsIn };
  const opts = { maxUnpackedBytes: limits.maxUnpackedBytes, maxEntries: limits.maxEntries };
  if (buf.length > 4 && buf.readUInt32LE(0) === 67324752) return { entries: extractZip(buf, opts), kind: "zip" };
  const outer = extractTar(buf, opts);
  const manifestEntry = outer.find((e) => e.path === "manifest.json" || e.path === "./manifest.json");
  let manifest = null;
  if (manifestEntry) {
    try {
      const parsed = JSON.parse(manifestEntry.data.toString("utf8"));
      if (Array.isArray(parsed) && parsed[0]?.Layers) manifest = parsed;
    } catch {
    }
  }
  if (!manifest) return { entries: outer, kind: "tar" };
  const byName = new Map(outer.map((e) => [e.path.replace(/^\.\//, ""), e]));
  const files = /* @__PURE__ */ new Map();
  const image = manifest[0];
  let unpacked = 0;
  for (const layerPath of image.Layers ?? []) {
    const layer = byName.get(layerPath);
    if (!layer) continue;
    for (const e of extractTar(layer.data, opts)) {
      const p = e.path.replace(/^\.\//, "");
      const base = p.split("/").pop() ?? p;
      if (base.startsWith(".wh.")) {
        const dir = p.slice(0, p.length - base.length);
        if (base === ".wh..wh..opq") {
          for (const k of files.keys()) if (k.startsWith(dir)) files.delete(k);
        } else files.delete(dir + base.slice(4));
        continue;
      }
      unpacked += e.size;
      if (unpacked > limits.maxUnpackedBytes) throw new Error("Image too large to scan (raise the unpacked size limit)");
      files.set(p, e);
      if (files.size > limits.maxEntries) throw new Error(`Image has more than ${limits.maxEntries} files`);
    }
  }
  const config = image.Config ? byName.get(image.Config) : void 0;
  if (config) files.set("[image config: ENV, labels & build history]", config);
  return { entries: [...files].map(([path4, e]) => ({ ...e, path: path4 })), kind: "docker" };
}
function scanEntries(entries, meta, options = {}) {
  const started = Date.now();
  const limits = { ...LIMITS, ...options.limits };
  if (entries.length === 0) throw new Error("No files found. Is this a valid package archive?");
  const ignored = compileGlobs(options.ignore ?? []);
  const ignoredRules = new Set(options.ignoreRules ?? []);
  let findings = [];
  let totalBytes = 0;
  let fileCount = 0;
  for (const entry of entries) {
    if (options.ignore?.length && ignored(normalizePath(entry.path))) continue;
    fileCount++;
    totalBytes += entry.size;
    scanEntry(entry, findings, limits);
  }
  if (ignoredRules.size) findings = findings.filter((f) => !ignoredRules.has(f.ruleId));
  const grouped = groupFindings(findings);
  grouped.sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || (b.occurrences ?? 1) - (a.occurrences ?? 1) || a.file.localeCompare(b.file)
  );
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of grouped) counts[f.severity]++;
  let penalty = 0;
  for (const f of grouped) penalty += SEVERITY_WEIGHT[f.severity] * Math.min(2, 1 + Math.log10(f.occurrences ?? 1));
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  return {
    target: meta.target,
    version: meta.version,
    source: meta.source,
    kind: meta.kind ?? "tar",
    fileCount,
    totalBytes,
    score,
    grade: grade(score),
    counts,
    findings: grouped.slice(0, limits.maxFindings),
    scannedAt: (/* @__PURE__ */ new Date()).toISOString(),
    durationMs: Date.now() - started
  };
}
var SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
function exceedsThreshold(report, failOn) {
  if (failOn === "none") return false;
  return report.findings.some((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[failOn]);
}

// lib/npm.ts
var REGISTRY = "https://registry.npmjs.org";
var NAME_RE = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
var VERSION_RE = /^[a-zA-Z0-9.+_-]{1,64}$/;
var MAX_TARBALL_BYTES = 40 * 1024 * 1024;
function parseSpec(input2) {
  const spec = input2.trim().replace(/^npm\s+(i|install)\s+/, "").replace(/^https?:\/\/(www\.)?npmjs\.com\/package\//, "");
  const at = spec.lastIndexOf("@");
  const [name, version] = at > 0 ? [spec.slice(0, at), spec.slice(at + 1)] : [spec, "latest"];
  const lower = name.toLowerCase();
  if (!NAME_RE.test(lower) || lower.length > 214) throw new Error("That doesn't look like a valid npm package name.");
  if (!VERSION_RE.test(version)) throw new Error("Invalid version or tag.");
  return { name: lower, version };
}
async function fetchNpmTarball(spec, opts = {}) {
  const { name, version: requested } = parseSpec(spec);
  const registry = (opts.registry ?? REGISTRY).replace(/\/$/, "");
  const registryUrl = new URL(registry);
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(registryUrl.hostname);
  if (registryUrl.protocol !== "https:" && !isLocal) throw new Error("Registry must use https.");
  const auth = opts.token ? { authorization: `Bearer ${opts.token}` } : {};
  const maxBytes = opts.maxBytes ?? MAX_TARBALL_BYTES;
  const limitMsg = `Package is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB scan limit.`;
  const encoded = name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
  const res = await fetch(`${registry}/${encoded}`, {
    headers: { accept: "application/vnd.npm.install-v1+json", ...auth },
    signal: AbortSignal.timeout(1e4),
    cache: "no-store"
  });
  if (res.status === 404) throw new Error(`Package "${name}" was not found on npm.`);
  if (!res.ok) throw new Error(`npm registry returned ${res.status}.`);
  const doc = await res.json();
  const version = doc["dist-tags"]?.[requested] ?? requested;
  const dist = doc.versions?.[version]?.dist;
  if (!dist?.tarball) throw new Error(`Version "${requested}" of ${name} was not found.`);
  const url = new URL(dist.tarball);
  if (url.hostname !== registryUrl.hostname || url.protocol !== "https:" && !isLocal) throw new Error("Unexpected tarball location.");
  const tar = await fetch(url, { headers: auth, signal: AbortSignal.timeout(6e4), cache: "no-store" });
  if (!tar.ok || !tar.body) throw new Error(`Could not download tarball (${tar.status}).`);
  const declared = Number(tar.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error(limitMsg);
  const chunks = [];
  let total = 0;
  const reader = tar.body.getReader();
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(limitMsg);
    }
    chunks.push(value);
  }
  return { name, version, data: Buffer.concat(chunks) };
}

// lib/license.ts
import { createPublicKey, verify } from "node:crypto";

// lib/license-public-key.ts
var LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAWX09v5yLHCaBGentnfODHhGVFcCIoAJAK8TA444gKWU=
-----END PUBLIC KEY-----`;

// lib/license.ts
var TOKEN_PREFIX = "rs_";
function verifyLicenseToken(token, publicKeyPem = LICENSE_PUBLIC_KEY_PEM) {
  const t = token.trim();
  if (!t.startsWith(TOKEN_PREFIX)) return null;
  const [body, sig] = t.slice(TOKEN_PREFIX.length).split(".");
  if (!body || !sig) return null;
  try {
    const ok = verify(null, Buffer.from(body), createPublicKey(publicKeyPem), Buffer.from(sig, "base64url"));
    if (!ok) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.v !== 1 || !payload.sub || payload.plan !== "standard" && payload.plan !== "pro") return null;
    return payload;
  } catch {
    return null;
  }
}

// cli/src/license-client.ts
function allowedIssuer(iss) {
  try {
    const u = new URL(iss);
    return u.protocol === "https:" || u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
  } catch {
    return false;
  }
}
async function resolveLicense(token) {
  if (!token?.trim()) return { tier: "free", status: "none" };
  const payload = verifyLicenseToken(token);
  if (!payload) return { tier: "free", status: "invalid", message: "RELEASESHIELD_TOKEN is not a valid ReleaseShield license token." };
  const base = (process.env.RELEASESHIELD_API_URL ?? payload.iss).replace(/\/$/, "");
  const grace = {
    tier: payload.plan,
    status: "offline-grace",
    email: payload.email,
    message: "Couldn't reach the license server; using your signed license offline."
  };
  if (!allowedIssuer(base)) return grace;
  try {
    const res = await fetch(`${base}/api/license/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "releaseshield-cli" },
      body: JSON.stringify({ token: token.trim() }),
      signal: AbortSignal.timeout(6e3)
    });
    if (!res.ok) return grace;
    const data = await res.json();
    if (data.valid) return { tier: data.plan === "pro" ? "pro" : "standard", status: "verified", email: payload.email };
    return {
      tier: "free",
      status: "inactive",
      email: payload.email,
      message: `License is no longer active (${data.status ?? data.reason ?? "unknown"}). Renew at ${base}/#pricing`
    };
  } catch {
    return grace;
  }
}

// cli/src/targets.ts
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
var ARCHIVE_RE = /\.(tgz|tar\.gz|tar|whl|zip)$/i;
var IMAGE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,255}$/;
var isWin = process.platform === "win32";
var Workspace = class {
  dirs = [];
  tmp() {
    const d = mkdtempSync(path.join(tmpdir(), "releaseshield-"));
    this.dirs.push(d);
    return d;
  }
  cleanup() {
    for (const d of this.dirs) rmSync(d, { recursive: true, force: true });
    this.dirs = [];
  }
};
function readPkgName(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).name;
  } catch {
    return void 0;
  }
}
function npmPackTarget(dir, ws, opts) {
  const name = readPkgName(dir);
  return {
    label: name ?? path.basename(dir),
    source: "file",
    npmName: name,
    load: async () => {
      const out = ws.tmp();
      opts.log(`Running npm pack in ${dir} \u2026`);
      try {
        execFileSync("npm", ["pack", "--pack-destination", out, "--silent"], { cwd: dir, stdio: ["ignore", "ignore", "inherit"], shell: isWin });
      } catch {
        throw new Error("`npm pack` failed (see output above).");
      }
      const tgz = readdirSync(out).find((f) => f.endsWith(".tgz"));
      if (!tgz) throw new Error("`npm pack` did not produce a tarball.");
      let version;
      try {
        version = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version;
      } catch {
      }
      return { data: readFileSync(path.join(out, tgz)), version };
    }
  };
}
function fileTarget(file, opts) {
  return {
    label: file,
    source: "file",
    load: async () => {
      const size = statSync(file).size;
      if (size > opts.maxBytes) throw new Error(`${file} is larger than the ${Math.round(opts.maxBytes / 1024 / 1024)} MB limit.`);
      return { data: readFileSync(file) };
    }
  };
}
function expandGlob(pattern, cwd) {
  const abs = path.resolve(cwd, pattern);
  const dir = path.dirname(abs);
  const base = path.basename(abs);
  if (/[*?]/.test(dir)) throw new Error(`Wildcards are only supported in the file name: ${pattern}`);
  if (!existsSync(dir)) return [];
  const re = new RegExp("^" + base.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  return readdirSync(dir).filter((f) => re.test(f)).map((f) => path.join(dir, f)).filter((f) => statSync(f).isFile());
}
function resolveTargets(specs, cwd, ws, opts) {
  const out = [];
  if (specs.length === 0) {
    if (existsSync(path.join(cwd, "package.json"))) return [npmPackTarget(cwd, ws, opts)];
    const dist = path.join(cwd, "dist");
    if (existsSync(dist)) {
      const files = readdirSync(dist).filter((f) => /\.(whl|tar\.gz|tgz)$/i.test(f));
      if (files.length) return files.map((f) => fileTarget(path.join(dist, f), opts));
    }
    throw new Error("Nothing to scan. Pass an artifact (e.g. ./my-pkg-1.0.0.tgz, dist/*.whl, npm:<name>, docker:<image>) or run inside an npm package.");
  }
  for (const spec of specs) {
    if (spec.startsWith("npm:")) {
      const pkg = spec.slice(4);
      out.push({
        label: pkg,
        source: "npm",
        npmName: pkg.replace(/(.)@[^@/]*$/, "$1"),
        load: async () => {
          const r = await fetchNpmTarball(pkg, { registry: opts.registry, token: opts.npmToken, maxBytes: opts.maxBytes });
          return { data: r.data, version: r.version };
        }
      });
    } else if (spec.startsWith("docker:")) {
      const image = spec.slice(7);
      if (!IMAGE_RE.test(image)) throw new Error(`Invalid image reference: ${image}`);
      out.push({
        label: image,
        source: "docker",
        load: async () => {
          const file = path.join(ws.tmp(), "image.tar");
          opts.log(`Exporting ${image} with docker save \u2026`);
          try {
            execFileSync("docker", ["save", image, "-o", file], { stdio: ["ignore", "ignore", "inherit"], shell: isWin });
          } catch {
            throw new Error(`\`docker save ${image}\` failed. Is Docker running and the image built/pulled?`);
          }
          return fileTarget(file, opts).load();
        }
      });
    } else if (/[*?]/.test(spec)) {
      const files = expandGlob(spec, cwd);
      if (!files.length) throw new Error(`No files match ${spec}`);
      for (const f of files) out.push(fileTarget(path.relative(cwd, f) || f, opts));
    } else {
      const abs = path.resolve(cwd, spec);
      if (!existsSync(abs)) throw new Error(`File not found: ${spec}`);
      if (statSync(abs).isDirectory()) {
        if (existsSync(path.join(abs, "package.json"))) out.push(npmPackTarget(abs, ws, opts));
        else throw new Error(`${spec} is a directory. Pass a built artifact (.tgz, .whl, .tar.gz) instead.`);
      } else {
        if (!ARCHIVE_RE.test(abs)) opts.log(`warning: ${spec} doesn't look like a package archive; trying anyway`);
        out.push(fileTarget(spec, opts));
      }
    }
  }
  return out;
}

// cli/src/version.ts
var VERSION = true ? "1.0.0" : "0.0.0-dev";

// cli/src/format.ts
var FORMATS = ["text", "json", "sarif", "markdown"];
var SEV_ICON = { critical: "\u{1F6D1}", high: "\u{1F536}", medium: "\u{1F7E1}", low: "\u26AA" };
function where(f) {
  return `${f.file}${f.line ? `:${f.line}` : ""}`;
}
function bytes(n) {
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function renderText(input2, color) {
  const c = (code, s) => color ? `\x1B[${code}m${s}\x1B[0m` : s;
  const sevColor = { critical: "1;31", high: "33", medium: "93", low: "90" };
  const gradeColor = { A: "1;32", B: "1;36", C: "1;33", D: "1;33", F: "1;31" };
  const lines = [];
  for (const r of input2.reports) {
    lines.push("");
    lines.push(`${c("1", r.target)}${r.version ? c("90", "@" + r.version) : ""}  ${c(gradeColor[r.grade], `grade ${r.grade}`)} ${c("90", `(${r.score}/100 \xB7 ${r.fileCount} files \xB7 ${bytes(r.totalBytes)} \xB7 ${r.kind})`)}`);
    lines.push(
      `  ${c(sevColor.critical, `${r.counts.critical} critical`)}  ${c(sevColor.high, `${r.counts.high} high`)}  ${c(sevColor.medium, `${r.counts.medium} medium`)}  ${c(sevColor.low, `${r.counts.low} low`)}`
    );
    if (r.findings.length === 0) lines.push(c("32", "  \u2713 No leaks detected"));
    for (const f of r.findings) {
      lines.push(`  ${c(sevColor[f.severity], f.severity.toUpperCase().padEnd(8))} ${f.title}`);
      lines.push(`           ${c("36", where(f))}${f.evidence ? c("90", `  ${f.evidence}`) : ""}`);
      lines.push(c("90", `           \u2192 ${f.advice}`));
    }
    if (r.diff) {
      lines.push(c("1", `  Changes vs ${r.diff.baseline}: +${r.diff.added.length} / -${r.diff.removed.length} files`));
      for (const a of r.diff.added.slice(0, 50)) lines.push(c("32", `    + ${a}`));
      if (r.diff.added.length > 50) lines.push(c("90", `    \u2026 and ${r.diff.added.length - 50} more`));
    }
  }
  for (const e of input2.errors) lines.push(c("31", `
\u2716 ${e.target}: ${e.message}`));
  lines.push("");
  if (input2.enforced) {
    lines.push(
      input2.failed ? c("1;31", `\u2716 ReleaseShield: findings at or above "${input2.failOn}". Release blocked.`) : c("1;32", `\u2713 ReleaseShield: no findings at or above "${input2.failOn}". Safe to publish.`)
    );
  } else if (input2.license.tier === "free") {
    lines.push(c("33", "\u2139 Free mode: report only. Add RELEASESHIELD_TOKEN (Standard $19/mo or Pro / Team $49/mo) to block releases in CI, plus SARIF/JSON output and Slack alerts."));
  }
  return lines.join("\n") + "\n";
}
function renderJson(input2) {
  return JSON.stringify(
    {
      tool: "releaseshield",
      version: VERSION,
      failOn: input2.failOn,
      failed: input2.failed,
      enforced: input2.enforced,
      plan: input2.license.tier,
      reports: input2.reports,
      errors: input2.errors
    },
    null,
    2
  ) + "\n";
}
function renderMarkdown(input2) {
  const out = ["## \u{1F6E1}\uFE0F ReleaseShield scan", ""];
  if (input2.enforced) {
    out.push(input2.failed ? `**\u274C Release blocked**: findings at or above \`${input2.failOn}\`.` : `**\u2705 Safe to publish**: nothing at or above \`${input2.failOn}\`.`, "");
  }
  out.push("| Artifact | Grade | Score | \u{1F6D1} Critical | \u{1F536} High | \u{1F7E1} Medium | \u26AA Low |", "|---|---|---|---|---|---|---|");
  for (const r of input2.reports) {
    out.push(`| \`${r.target}${r.version ? "@" + r.version : ""}\` | **${r.grade}** | ${r.score} | ${r.counts.critical} | ${r.counts.high} | ${r.counts.medium} | ${r.counts.low} |`);
  }
  for (const r of input2.reports) {
    if (!r.findings.length && !r.diff) continue;
    out.push("", `### ${r.target}`, "");
    if (r.findings.length) {
      out.push("| Severity | Finding | File | Evidence |", "|---|---|---|---|");
      for (const f of r.findings) {
        out.push(`| ${SEV_ICON[f.severity]} ${f.severity} | ${f.title} | \`${where(f).replace(/\|/g, "\\|")}\` | ${(f.evidence ?? "").replace(/\|/g, "\\|")} |`);
      }
    }
    if (r.diff?.added.length) {
      out.push("", `<details><summary>${r.diff.added.length} new file(s) vs ${r.diff.baseline}</summary>`, "", ...r.diff.added.slice(0, 200).map((a) => `- \`${a}\``), "", "</details>");
    }
  }
  for (const e of input2.errors) out.push("", `> \u274C **${e.target}**: ${e.message}`);
  return out.join("\n") + "\n";
}
var SARIF_LEVEL = { critical: "error", high: "error", medium: "warning", low: "note" };
var SECURITY_SEVERITY = { critical: "9.5", high: "7.5", medium: "5.0", low: "2.0" };
function renderSarif(input2) {
  const rules = /* @__PURE__ */ new Map();
  for (const r of input2.reports) for (const f of r.findings) if (!rules.has(f.ruleId)) rules.set(f.ruleId, f);
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "ReleaseShield",
            version: VERSION,
            informationUri: "https://github.com/releaseshield",
            rules: [...rules.values()].map((f) => ({
              id: f.ruleId,
              name: f.ruleId,
              shortDescription: { text: f.title.replace(/ \(\d+ files\)$/, "") },
              help: { text: f.advice },
              defaultConfiguration: { level: SARIF_LEVEL[f.severity] },
              properties: { "security-severity": SECURITY_SEVERITY[f.severity], tags: ["security", "release", "leak"] }
            }))
          }
        },
        results: input2.reports.flatMap(
          (r) => r.findings.map((f) => ({
            ruleId: f.ruleId,
            level: SARIF_LEVEL[f.severity],
            message: { text: `${f.title} in published artifact ${r.target}${r.version ? "@" + r.version : ""}: ${where(f)}${f.evidence ? ` (${f.evidence})` : ""}. ${f.advice}` },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: f.file.replace(/^\[.*\]$/, "image-config") },
                  ...f.line ? { region: { startLine: f.line } } : {}
                }
              }
            ],
            partialFingerprints: { releaseshield: `${r.target}:${f.ruleId}:${f.file}` }
          }))
        )
      }
    ]
  };
  return JSON.stringify(sarif, null, 2) + "\n";
}
function render(format, input2, color) {
  switch (format) {
    case "json":
      return renderJson(input2);
    case "sarif":
      return renderSarif(input2);
    case "markdown":
      return renderMarkdown(input2);
    default:
      return renderText(input2, color);
  }
}

// cli/src/core.ts
var FAIL_LEVELS = ["critical", "high", "medium", "low", "none"];
var CLI_LIMITS = { maxUnpackedBytes: 2 * 1024 * 1024 * 1024, maxEntries: 5e5, maxFindings: 1e3 };
var MAX_ARTIFACT_BYTES = 1.5 * 1024 * 1024 * 1024;
function loadConfig(cwd, explicit) {
  const file = explicit ? path2.resolve(cwd, explicit) : path2.join(cwd, ".releaseshield.json");
  if (!existsSync2(file)) {
    if (explicit) throw new Error(`Config file not found: ${explicit}`);
    return {};
  }
  try {
    const cfg = JSON.parse(readFileSync2(file, "utf8"));
    if (cfg.failOn && !FAIL_LEVELS.includes(cfg.failOn)) throw new Error(`invalid failOn "${cfg.failOn}"`);
    return cfg;
  } catch (e) {
    throw new Error(`Invalid ${path2.basename(file)}: ${e instanceof Error ? e.message : e}`);
  }
}
var rank = { free: 0, standard: 1, pro: 2 };
var has = (tier, need) => rank[tier] >= rank[need];
async function loadBaselineFiles(spec, target, cwd, opts) {
  let data;
  let label;
  if (spec === "auto") {
    if (!target.npmName) return null;
    const r = await fetchNpmTarball(`${target.npmName}@latest`, { registry: opts.registry, token: opts.npmToken, maxBytes: MAX_ARTIFACT_BYTES });
    data = r.data;
    label = `${target.npmName}@${r.version} (published)`;
  } else if (spec.startsWith("npm:")) {
    const r = await fetchNpmTarball(spec.slice(4), { registry: opts.registry, token: opts.npmToken, maxBytes: MAX_ARTIFACT_BYTES });
    data = r.data;
    label = `${r.name}@${r.version}`;
  } else {
    data = readFileSync2(path2.resolve(cwd, spec));
    label = spec;
  }
  const { entries } = readArchive(data, CLI_LIMITS);
  return { label, files: new Set(entries.map((e) => normalizePath(e.path))) };
}
async function notifySlack(webhook, input2, log) {
  const worst = input2.reports.filter((r) => r.counts.critical || r.counts.high);
  if (!input2.failed && worst.length === 0) return;
  const lines = input2.reports.map(
    (r) => `\u2022 *${r.target}${r.version ? "@" + r.version : ""}*: grade ${r.grade}, ${r.counts.critical} critical / ${r.counts.high} high`
  );
  const where2 = process.env.GITHUB_REPOSITORY ? ` in <${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}|${process.env.GITHUB_REPOSITORY}>` : "";
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `\u{1F6E1}\uFE0F ReleaseShield ${input2.failed ? "*blocked a release*" : "found issues"}${where2}
${lines.join("\n")}` }),
      signal: AbortSignal.timeout(5e3)
    });
    if (!res.ok) log(`warning: Slack webhook returned ${res.status}`);
  } catch {
    log("warning: could not reach Slack webhook");
  }
}
async function run(opts) {
  const log = opts.log;
  const license = await resolveLicense(opts.token);
  if (license.message) log(`${license.status === "offline-grace" ? "warning" : "license"}: ${license.message}`);
  const tier = license.tier;
  const config = loadConfig(opts.cwd, opts.configPath);
  let format = opts.format ?? "text";
  const failOn = opts.failOn ?? config.failOn ?? "critical";
  const enforced = has(tier, "standard");
  if (format !== "text" && !has(tier, "standard")) {
    log(`note: --format ${format} requires a Standard or Pro / Team license; showing text output.`);
    format = "text";
  }
  let ignore = [...config.ignore ?? [], ...opts.ignore ?? []];
  let ignoreRules = [...config.ignoreRules ?? [], ...opts.ignoreRules ?? []];
  let baseline = opts.baseline ?? config.baseline;
  let registry = opts.registry ?? config.registry;
  let slack = opts.slackWebhook;
  if (!has(tier, "pro")) {
    if (ignore.length || ignoreRules.length) log("note: custom ignore policies require Pro / Team; scanning everything.");
    if (baseline) log("note: release diffing (--baseline) requires Pro / Team; skipped.");
    if (registry) log("note: private registries require Pro / Team; using the public npm registry.");
    ignore = [];
    ignoreRules = [];
    baseline = void 0;
    registry = void 0;
  }
  if (slack && !has(tier, "standard")) {
    log("note: Slack alerts require a Standard or Pro / Team license; skipped.");
    slack = void 0;
  }
  const ws = new Workspace();
  const reports = [];
  const errors = [];
  try {
    const targets = resolveTargets(opts.targets, opts.cwd, ws, { registry, npmToken: opts.npmToken, maxBytes: MAX_ARTIFACT_BYTES, log });
    for (const t of targets) {
      try {
        log(`Scanning ${t.label} \u2026`);
        const loaded = await t.load();
        const { entries, kind } = readArchive(loaded.data, CLI_LIMITS);
        const report = scanEntries(
          entries,
          { target: t.label, version: loaded.version, source: t.source, kind },
          { ignore: kind === "docker" ? [...DOCKER_DEFAULT_IGNORE, ...ignore] : ignore, ignoreRules, limits: CLI_LIMITS }
        );
        if (baseline) {
          try {
            const base = await loadBaselineFiles(baseline, t, opts.cwd, { ...opts, registry });
            if (base) {
              const current = new Set(entries.map((e) => normalizePath(e.path)));
              report.diff = {
                baseline: base.label,
                added: [...current].filter((f) => !base.files.has(f)).sort(),
                removed: [...base.files].filter((f) => !current.has(f)).sort()
              };
            } else log(`note: no baseline available for ${t.label}`);
          } catch (e) {
            log(`warning: baseline unavailable for ${t.label}: ${e instanceof Error ? e.message : e}`);
          }
        }
        reports.push(report);
      } catch (e) {
        errors.push({ target: t.label, message: e instanceof Error ? e.message : String(e) });
      }
    }
  } catch (e) {
    errors.push({ target: "releaseshield", message: e instanceof Error ? e.message : String(e) });
  } finally {
    ws.cleanup();
  }
  const failed = reports.some((r) => exceedsThreshold(r, failOn));
  const input2 = { reports, errors, failOn, failed, enforced, license };
  if (slack) await notifySlack(slack, input2, log);
  const exitCode = errors.length ? 2 : failed && enforced ? 1 : 0;
  return { ...input2, format, output: render(format, input2, opts.color ?? false), exitCode };
}

// action/src/index.ts
function input(name) {
  return (process.env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] ?? "").trim();
}
function list(name) {
  return input(name).split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
}
function esc(s) {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function escProp(s) {
  return esc(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}
function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}=${String(value).replace(/\n/g, " ")}
`);
}
var ANNOTATION = { critical: "error", high: "error", medium: "warning", low: "notice" };
async function main() {
  const token = input("token") || process.env.RELEASESHIELD_TOKEN || "";
  if (token) process.stdout.write(`::add-mask::${token}
`);
  const wd = input("working-directory");
  const cwd = wd ? path3.resolve(process.env.GITHUB_WORKSPACE ?? process.cwd(), wd) : process.cwd();
  const failOnRaw = input("fail-on") || void 0;
  if (failOnRaw && !FAIL_LEVELS.includes(failOnRaw)) throw new Error(`fail-on must be one of ${FAIL_LEVELS.join(", ")}`);
  const formatRaw = input("format") || "text";
  if (!FORMATS.includes(formatRaw)) throw new Error(`format must be one of ${FORMATS.join(", ")}`);
  const result = await run({
    targets: list("artifact"),
    cwd,
    failOn: failOnRaw,
    format: formatRaw,
    configPath: input("config") || void 0,
    ignore: list("ignore"),
    baseline: input("baseline") || void 0,
    registry: input("registry") || void 0,
    npmToken: input("npm-token") || process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN,
    token,
    slackWebhook: input("slack-webhook") || void 0,
    color: true,
    log: (m) => process.stdout.write(`${m}
`)
  });
  process.stdout.write(result.output);
  const licensed = result.license.tier !== "free";
  const all = result.reports.flatMap((r) => r.findings.map((f) => ({ r, f })));
  if (licensed) {
    for (const { r, f } of all.slice(0, 50)) {
      const title = escProp(`ReleaseShield: ${f.title}`);
      process.stdout.write(`::${ANNOTATION[f.severity]} title=${title}::${esc(`${r.target}: ${f.file}${f.line ? `:${f.line}` : ""}${f.evidence ? ` (${f.evidence})` : ""}. ${f.advice}`)}
`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderMarkdown(result));
    const tmp = process.env.RUNNER_TEMP ?? cwd;
    const reportPath = path3.join(tmp, "releaseshield-report.json");
    writeFileSync(reportPath, renderJson(result));
    setOutput("report-path", reportPath);
    const sarifOut = input("sarif-output");
    if (sarifOut) {
      const p = path3.resolve(cwd, sarifOut);
      writeFileSync(p, renderSarif(result));
      setOutput("sarif-path", p);
    }
  } else if (input("sarif-output")) {
    process.stdout.write("::notice title=ReleaseShield::SARIF output requires a Standard or Pro license (set the token input).\n");
  }
  const worst = result.reports.reduce((w, r) => r.score < w.score ? r : w, result.reports[0] ?? { score: 100, grade: "A" });
  setOutput("grade", worst.grade);
  setOutput("score", worst.score);
  setOutput("findings", all.length);
  setOutput("critical", result.reports.reduce((n, r) => n + r.counts.critical, 0));
  setOutput("failed", result.failed && result.enforced);
  setOutput("plan", result.license.tier);
  for (const e of result.errors) process.stdout.write(`::error title=ReleaseShield scan error::${esc(`${e.target}: ${e.message}`)}
`);
  if (result.failed && result.enforced) {
    process.stdout.write(`::error title=ReleaseShield blocked this release::${esc(`Findings at or above "${result.failOn}" in the artifact. See the job summary.`)}
`);
  }
  process.exitCode = result.exitCode;
}
main().catch((e) => {
  process.stdout.write(`::error title=ReleaseShield::${esc(e instanceof Error ? e.message : String(e))}
`);
  process.exitCode = 2;
});
