import { extractTar, type TarEntry } from "./tar";
import { extractZip } from "./zip";
import { compileGlobs } from "./glob";
import { CONTENT_RULES, PATH_RULES, SEVERITY_ORDER, SEVERITY_WEIGHT, type Severity } from "./rules";

export interface Finding {
  ruleId: string;
  title: string;
  severity: Severity;
  file: string;
  line?: number;
  evidence?: string;
  advice: string;
  /** Number of files this (grouped) finding covers. */
  occurrences?: number;
}

export interface ScanReport {
  target: string;
  version?: string;
  source: ScanSource;
  kind: ArchiveKind;
  diff?: { baseline: string; added: string[]; removed: string[] };
  fileCount: number;
  totalBytes: number;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  counts: Record<Severity, number>;
  findings: Finding[];
  scannedAt: string;
  durationMs: number;
}

export type ScanSource = "npm" | "upload" | "file" | "docker";
export type ArchiveKind = "tar" | "zip" | "docker";
export type Limits = typeof LIMITS;

export interface ScanOptions {
  /** gitignore-style globs of files to skip entirely */
  ignore?: string[];
  /** rule IDs to suppress */
  ignoreRules?: string[];
  limits?: Partial<Limits>;
}

export interface ScanMeta {
  target: string;
  version?: string;
  source: ScanSource;
}

/** Noise from OS packages in container images (test certs, docs, etc.). */
export const DOCKER_DEFAULT_IGNORE = [
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
  "dev/**",
];

export const LIMITS = {
  maxUnpackedBytes: 150 * 1024 * 1024,
  maxEntries: 20_000,
  maxTextScanBytes: 2 * 1024 * 1024,
  maxFindings: 200,
  maxContentHitsPerFile: 5,
};

const TEST_PATH = /(^|\/)(tests?|__tests__|__mocks__|spec|fixtures?|examples?)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;
const PLACEHOLDER = /x{6,}|your[_-]?(api[_-]?)?(key|token|secret)|example|placeholder|dummy|<[^>]+>|\$\{|\{\{|%s|:(pass(word)?|secret|changeme|\*+)@/i;

function mask(value: string): string {
  const v = value.trim();
  if (v.length <= 12) return `${v.slice(0, 3)}…`;
  return `${v.slice(0, 6)}…${v.slice(-4)} (${v.length} chars)`;
}

function isProbablyText(data: Buffer): boolean {
  const n = Math.min(data.length, 8000);
  for (let i = 0; i < n; i++) if (data[i] === 0) return false;
  return true;
}

export function normalizePath(path: string): string {
  // npm tarballs nest everything under "package/"
  return path.replace(/^\.\//, "").replace(/^package\//, "");
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function scanEntry(entry: TarEntry, findings: Finding[], limits: Limits) {
  const file = normalizePath(entry.path);
  const base = file.split("/").pop() ?? file;

  for (const rule of PATH_RULES) {
    if (rule.test(file, base)) {
      findings.push({ ruleId: rule.id, title: rule.title, severity: rule.severity, file, advice: rule.advice });
    }
  }

  if (entry.size === 0 || entry.size > limits.maxTextScanBytes || !isProbablyText(entry.data)) return;
  const text = entry.data.toString("utf8");

  // Source maps that embed original source are worse than bare maps, but not a secret:
  // for open-source packages the code is already public. High, not critical, so it
  // never outranks a leaked key or trips the default fail-on.
  if (/\.map$/i.test(base) && /"sourcesContent"\s*:\s*\[\s*"/.test(text)) {
    const bare = findings.findIndex((f) => f.ruleId === "source-map" && f.file === file);
    if (bare !== -1) findings.splice(bare, 1);
    const m = text.match(/"sources"\s*:\s*\[([^\]]*)\]/);
    const n = m ? m[1].split(",").filter((s) => s.trim()).length : 0;
    findings.push({
      ruleId: "source-map-embedded",
      title: "Source map embeds full original source",
      severity: "high",
      file,
      evidence: n ? `${n} original source file${n === 1 ? "" : "s"} recoverable` : "sourcesContent present",
      advice: "Anyone can rebuild your original, unminified source from this file. Remove it from the release.",
    });
  }

  const isTestFile = TEST_PATH.test(file);
  let hits = 0;
  for (const rule of CONTENT_RULES) {
    if (hits >= limits.maxContentHitsPerFile) break;
    // Test fixtures are full of fake tokens; only real-format critical secrets count there.
    if (isTestFile && rule.severity !== "critical") continue;
    const match = rule.pattern.exec(text);
    if (!match) continue;
    // skip obvious placeholders
    if (PLACEHOLDER.test(match[0])) continue;
    hits++;
    findings.push({
      ruleId: rule.id,
      title: rule.title,
      severity: rule.severity,
      file,
      line: lineOf(text, match.index),
      evidence: rule.id === "private-key" ? match[0] : mask(match[0]),
      advice: rule.advice,
    });
  }
}

const GROUP_THRESHOLD = 3;

/** Collapse noisy rules (same rule hitting many files) into one finding. Secrets are never collapsed. */
function groupFindings(findings: Finding[]): Finding[] {
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byRule.get(f.ruleId) ?? [];
    list.push(f);
    byRule.set(f.ruleId, list);
  }
  const out: Finding[] = [];
  for (const list of byRule.values()) {
    const isSecret = list[0].line !== undefined;
    if (isSecret || list.length <= GROUP_THRESHOLD) {
      out.push(...list);
      continue;
    }
    const sample = list.slice(0, 3).map((f) => f.file);
    out.push({
      ...list[0],
      title: `${list[0].title} (${list.length} files)`,
      file: sample[0],
      evidence: `e.g. ${sample.join(", ")}${list.length > 3 ? ` and ${list.length - 3} more` : ""}`,
      occurrences: list.length,
    });
  }
  return out;
}

function grade(score: number): ScanReport["grade"] {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 55) return "C";
  if (score >= 35) return "D";
  return "F";
}

interface DockerManifest {
  Config?: string;
  Layers?: string[];
}

/** Unpack a .tgz/.tar/.whl/.zip or a `docker save` tarball into a flat file list. */
export function readArchive(buf: Buffer, limitsIn: Partial<Limits> = {}): { entries: TarEntry[]; kind: ArchiveKind } {
  const limits = { ...LIMITS, ...limitsIn };
  const opts = { maxUnpackedBytes: limits.maxUnpackedBytes, maxEntries: limits.maxEntries };

  if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) return { entries: extractZip(buf, opts), kind: "zip" };

  const outer = extractTar(buf, opts);
  const manifestEntry = outer.find((e) => e.path === "manifest.json" || e.path === "./manifest.json");
  let manifest: DockerManifest[] | null = null;
  if (manifestEntry) {
    try {
      const parsed = JSON.parse(manifestEntry.data.toString("utf8"));
      if (Array.isArray(parsed) && parsed[0]?.Layers) manifest = parsed as DockerManifest[];
    } catch {
      /* not a docker image */
    }
  }
  if (!manifest) return { entries: outer, kind: "tar" };

  // docker save: merge layers in order, honouring whiteouts; include image config (ENV, history).
  const byName = new Map(outer.map((e) => [e.path.replace(/^\.\//, ""), e]));
  const files = new Map<string, TarEntry>();
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
  const config = image.Config ? byName.get(image.Config) : undefined;
  if (config) files.set("[image config: ENV, labels & build history]", config);
  return { entries: [...files].map(([path, e]) => ({ ...e, path })), kind: "docker" };
}

export function scanEntries(entries: TarEntry[], meta: ScanMeta & { kind?: ArchiveKind }, options: ScanOptions = {}): ScanReport {
  const started = Date.now();
  const limits = { ...LIMITS, ...options.limits };
  if (entries.length === 0) throw new Error("No files found. Is this a valid package archive?");

  const ignored = compileGlobs(options.ignore ?? []);
  const ignoredRules = new Set(options.ignoreRules ?? []);

  let findings: Finding[] = [];
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
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      (b.occurrences ?? 1) - (a.occurrences ?? 1) ||
      a.file.localeCompare(b.file),
  );

  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of grouped) counts[f.severity]++;

  // Penalise per finding group with diminishing returns for repeated files,
  // so one systematic issue (e.g. 900 source maps) doesn't outweigh a leaked secret.
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
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
  };
}

export function scanArchive(archive: Buffer, meta: ScanMeta, options: ScanOptions = {}): ScanReport {
  const { entries, kind } = readArchive(archive, options.limits);
  const ignore = kind === "docker" ? [...DOCKER_DEFAULT_IGNORE, ...(options.ignore ?? [])] : options.ignore;
  return scanEntries(entries, { ...meta, kind }, { ...options, ignore });
}

export const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

/** True if any finding is at or above the threshold. */
export function exceedsThreshold(report: ScanReport, failOn: Severity | "none"): boolean {
  if (failOn === "none") return false;
  return report.findings.some((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[failOn]);
}
