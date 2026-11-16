import type { Finding, ScanReport } from "../../lib/scanner";
import type { Severity } from "../../lib/rules";
import type { LicenseState } from "./license-client";
import { VERSION } from "./version";

export type Format = "text" | "json" | "sarif" | "markdown";
export const FORMATS: Format[] = ["text", "json", "sarif", "markdown"];

export interface RenderInput {
  reports: ScanReport[];
  errors: { target: string; message: string }[];
  failOn: Severity | "none";
  failed: boolean;
  enforced: boolean;
  license: LicenseState;
}

const SEV_ICON: Record<Severity, string> = { critical: "🛑", high: "🔶", medium: "🟡", low: "⚪" };

function where(f: Finding) {
  return `${f.file}${f.line ? `:${f.line}` : ""}`;
}

function bytes(n: number) {
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function renderText(input: RenderInput, color: boolean): string {
  const c = (code: string, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const sevColor: Record<Severity, string> = { critical: "1;31", high: "33", medium: "93", low: "90" };
  const gradeColor: Record<string, string> = { A: "1;32", B: "1;36", C: "1;33", D: "1;33", F: "1;31" };
  const lines: string[] = [];

  for (const r of input.reports) {
    lines.push("");
    lines.push(`${c("1", r.target)}${r.version ? c("90", "@" + r.version) : ""}  ${c(gradeColor[r.grade], `grade ${r.grade}`)} ${c("90", `(${r.score}/100 · ${r.fileCount} files · ${bytes(r.totalBytes)} · ${r.kind})`)}`);
    lines.push(
      `  ${c(sevColor.critical, `${r.counts.critical} critical`)}  ${c(sevColor.high, `${r.counts.high} high`)}  ${c(sevColor.medium, `${r.counts.medium} medium`)}  ${c(sevColor.low, `${r.counts.low} low`)}`,
    );
    if (r.findings.length === 0) lines.push(c("32", "  ✓ No leaks detected"));
    for (const f of r.findings) {
      lines.push(`  ${c(sevColor[f.severity], f.severity.toUpperCase().padEnd(8))} ${f.title}`);
      lines.push(`           ${c("36", where(f))}${f.evidence ? c("90", `  ${f.evidence}`) : ""}`);
      lines.push(c("90", `           → ${f.advice}`));
    }
    if (r.diff) {
      lines.push(c("1", `  Changes vs ${r.diff.baseline}: +${r.diff.added.length} / -${r.diff.removed.length} files`));
      for (const a of r.diff.added.slice(0, 50)) lines.push(c("32", `    + ${a}`));
      if (r.diff.added.length > 50) lines.push(c("90", `    … and ${r.diff.added.length - 50} more`));
    }
  }
  for (const e of input.errors) lines.push(c("31", `\n✖ ${e.target}: ${e.message}`));

  lines.push("");
  if (input.enforced) {
    lines.push(
      input.failed
        ? c("1;31", `✖ ReleaseShield: findings at or above "${input.failOn}". Release blocked.`)
        : c("1;32", `✓ ReleaseShield: no findings at or above "${input.failOn}". Safe to publish.`),
    );
  } else if (input.license.tier === "free") {
    lines.push(c("33", "ℹ Free mode: report only. Add RELEASESHIELD_TOKEN (Standard/Pro) to block releases in CI, plus SARIF/JSON output and Slack alerts."));
  }
  return lines.join("\n") + "\n";
}

export function renderJson(input: RenderInput): string {
  return (
    JSON.stringify(
      {
        tool: "releaseshield",
        version: VERSION,
        failOn: input.failOn,
        failed: input.failed,
        enforced: input.enforced,
        plan: input.license.tier,
        reports: input.reports,
        errors: input.errors,
      },
      null,
      2,
    ) + "\n"
  );
}

export function renderMarkdown(input: RenderInput): string {
  const out: string[] = ["## 🛡️ ReleaseShield scan", ""];
  if (input.enforced) {
    out.push(input.failed ? `**❌ Release blocked**: findings at or above \`${input.failOn}\`.` : `**✅ Safe to publish**: nothing at or above \`${input.failOn}\`.`, "");
  }
  out.push("| Artifact | Grade | Score | 🛑 Critical | 🔶 High | 🟡 Medium | ⚪ Low |", "|---|---|---|---|---|---|---|");
  for (const r of input.reports) {
    out.push(`| \`${r.target}${r.version ? "@" + r.version : ""}\` | **${r.grade}** | ${r.score} | ${r.counts.critical} | ${r.counts.high} | ${r.counts.medium} | ${r.counts.low} |`);
  }
  for (const r of input.reports) {
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
  for (const e of input.errors) out.push("", `> ❌ **${e.target}**: ${e.message}`);
  return out.join("\n") + "\n";
}

const SARIF_LEVEL: Record<Severity, "error" | "warning" | "note"> = { critical: "error", high: "error", medium: "warning", low: "note" };
const SECURITY_SEVERITY: Record<Severity, string> = { critical: "9.5", high: "7.5", medium: "5.0", low: "2.0" };

export function renderSarif(input: RenderInput): string {
  const rules = new Map<string, Finding>();
  for (const r of input.reports) for (const f of r.findings) if (!rules.has(f.ruleId)) rules.set(f.ruleId, f);
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
              properties: { "security-severity": SECURITY_SEVERITY[f.severity], tags: ["security", "release", "leak"] },
            })),
          },
        },
        results: input.reports.flatMap((r) =>
          r.findings.map((f) => ({
            ruleId: f.ruleId,
            level: SARIF_LEVEL[f.severity],
            message: { text: `${f.title} in published artifact ${r.target}${r.version ? "@" + r.version : ""}: ${where(f)}${f.evidence ? ` (${f.evidence})` : ""}. ${f.advice}` },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: f.file.replace(/^\[.*\]$/, "image-config") },
                  ...(f.line ? { region: { startLine: f.line } } : {}),
                },
              },
            ],
            partialFingerprints: { releaseshield: `${r.target}:${f.ruleId}:${f.file}` },
          })),
        ),
      },
    ],
  };
  return JSON.stringify(sarif, null, 2) + "\n";
}

export function render(format: Format, input: RenderInput, color: boolean): string {
  switch (format) {
    case "json":
      return renderJson(input);
    case "sarif":
      return renderSarif(input);
    case "markdown":
      return renderMarkdown(input);
    default:
      return renderText(input, color);
  }
}
