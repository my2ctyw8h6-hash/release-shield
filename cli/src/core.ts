import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DOCKER_DEFAULT_IGNORE, exceedsThreshold, normalizePath, readArchive, scanEntries, type ScanReport } from "../../lib/scanner";
import type { Severity } from "../../lib/rules";
import { fetchNpmTarball } from "../../lib/npm";
import { resolveLicense, type LicenseState, type Tier } from "./license-client";
import { resolveTargets, Workspace, type ResolvedTarget } from "./targets";
import { render, type Format, type RenderInput } from "./format";

export const FAIL_LEVELS = ["critical", "high", "medium", "low", "none"] as const;
export type FailOn = Severity | "none";

export interface RunOptions {
  targets: string[];
  cwd: string;
  failOn?: FailOn;
  format?: Format;
  configPath?: string;
  ignore?: string[];
  ignoreRules?: string[];
  baseline?: string;
  registry?: string;
  npmToken?: string;
  token?: string;
  slackWebhook?: string;
  color?: boolean;
  log: (msg: string) => void;
}

export interface RunResult extends RenderInput {
  format: Format;
  output: string;
  exitCode: 0 | 1 | 2;
}

interface ConfigFile {
  failOn?: FailOn;
  ignore?: string[];
  ignoreRules?: string[];
  baseline?: string;
  registry?: string;
}

const CLI_LIMITS = { maxUnpackedBytes: 2 * 1024 * 1024 * 1024, maxEntries: 500_000, maxFindings: 1_000 };
const MAX_ARTIFACT_BYTES = 1.5 * 1024 * 1024 * 1024;

function loadConfig(cwd: string, explicit?: string): ConfigFile {
  const file = explicit ? path.resolve(cwd, explicit) : path.join(cwd, ".releaseshield.json");
  if (!existsSync(file)) {
    if (explicit) throw new Error(`Config file not found: ${explicit}`);
    return {};
  }
  try {
    const cfg = JSON.parse(readFileSync(file, "utf8")) as ConfigFile;
    if (cfg.failOn && !FAIL_LEVELS.includes(cfg.failOn)) throw new Error(`invalid failOn "${cfg.failOn}"`);
    return cfg;
  } catch (e) {
    throw new Error(`Invalid ${path.basename(file)}: ${e instanceof Error ? e.message : e}`);
  }
}

const rank: Record<Tier, number> = { free: 0, standard: 1, pro: 2 };
const has = (tier: Tier, need: Exclude<Tier, "free">) => rank[tier] >= rank[need];

async function loadBaselineFiles(spec: string, target: ResolvedTarget, cwd: string, opts: RunOptions): Promise<{ label: string; files: Set<string> } | null> {
  let data: Buffer;
  let label: string;
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
    data = readFileSync(path.resolve(cwd, spec));
    label = spec;
  }
  const { entries } = readArchive(data, CLI_LIMITS);
  return { label, files: new Set(entries.map((e) => normalizePath(e.path))) };
}

async function notifySlack(webhook: string, input: RenderInput, log: (m: string) => void) {
  const worst = input.reports.filter((r) => r.counts.critical || r.counts.high);
  if (!input.failed && worst.length === 0) return;
  const lines = input.reports.map(
    (r) => `• *${r.target}${r.version ? "@" + r.version : ""}*: grade ${r.grade}, ${r.counts.critical} critical / ${r.counts.high} high`,
  );
  const where = process.env.GITHUB_REPOSITORY
    ? ` in <${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}|${process.env.GITHUB_REPOSITORY}>`
    : "";
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `🛡️ ReleaseShield ${input.failed ? "*blocked a release*" : "found issues"}${where}\n${lines.join("\n")}` }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) log(`warning: Slack webhook returned ${res.status}`);
  } catch {
    log("warning: could not reach Slack webhook");
  }
}

export async function run(opts: RunOptions): Promise<RunResult> {
  const log = opts.log;
  const license: LicenseState = await resolveLicense(opts.token);
  if (license.message) log(`${license.status === "offline-grace" ? "warning" : "license"}: ${license.message}`);
  const tier = license.tier;

  const config = loadConfig(opts.cwd, opts.configPath);
  let format: Format = opts.format ?? "text";
  const failOn: FailOn = opts.failOn ?? config.failOn ?? "critical";
  const enforced = has(tier, "standard");

  if (format !== "text" && !has(tier, "standard")) {
    log(`note: --format ${format} requires a Standard or Pro license; showing text output.`);
    format = "text";
  }

  let ignore = [...(config.ignore ?? []), ...(opts.ignore ?? [])];
  let ignoreRules = [...(config.ignoreRules ?? []), ...(opts.ignoreRules ?? [])];
  let baseline = opts.baseline ?? config.baseline;
  let registry = opts.registry ?? config.registry;
  let slack = opts.slackWebhook;
  if (!has(tier, "pro")) {
    if (ignore.length || ignoreRules.length) log("note: custom ignore policies require Pro; scanning everything.");
    if (baseline) log("note: release diffing (--baseline) requires Pro; skipped.");
    if (registry) log("note: private registries require Pro; using the public npm registry.");
    ignore = [];
    ignoreRules = [];
    baseline = undefined;
    registry = undefined;
  }
  if (slack && !has(tier, "standard")) {
    log("note: Slack alerts require a Standard or Pro license; skipped.");
    slack = undefined;
  }

  const ws = new Workspace();
  const reports: ScanReport[] = [];
  const errors: { target: string; message: string }[] = [];
  try {
    const targets = resolveTargets(opts.targets, opts.cwd, ws, { registry, npmToken: opts.npmToken, maxBytes: MAX_ARTIFACT_BYTES, log });
    for (const t of targets) {
      try {
        log(`Scanning ${t.label} …`);
        const loaded = await t.load();
        const { entries, kind } = readArchive(loaded.data, CLI_LIMITS);
        const report = scanEntries(
          entries,
          { target: t.label, version: loaded.version, source: t.source, kind },
          { ignore: kind === "docker" ? [...DOCKER_DEFAULT_IGNORE, ...ignore] : ignore, ignoreRules, limits: CLI_LIMITS },
        );
        if (baseline) {
          try {
            const base = await loadBaselineFiles(baseline, t, opts.cwd, { ...opts, registry });
            if (base) {
              const current = new Set(entries.map((e) => normalizePath(e.path)));
              report.diff = {
                baseline: base.label,
                added: [...current].filter((f) => !base.files.has(f)).sort(),
                removed: [...base.files].filter((f) => !current.has(f)).sort(),
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
  const input: RenderInput = { reports, errors, failOn, failed, enforced, license };
  if (slack) await notifySlack(slack, input, log);

  const exitCode: 0 | 1 | 2 = errors.length ? 2 : failed && enforced ? 1 : 0;
  return { ...input, format, output: render(format, input, opts.color ?? false), exitCode };
}
