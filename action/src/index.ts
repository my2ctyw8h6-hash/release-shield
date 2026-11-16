import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { run, FAIL_LEVELS, type FailOn } from "../../cli/src/core";
import { renderJson, renderMarkdown, renderSarif, FORMATS, type Format } from "../../cli/src/format";
import type { Severity } from "../../lib/rules";

function input(name: string): string {
  return (process.env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] ?? "").trim();
}
function list(name: string): string[] {
  return input(name)
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function esc(s: string) {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function escProp(s: string) {
  return esc(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}
function setOutput(name: string, value: string | number | boolean) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}=${String(value).replace(/\n/g, " ")}\n`);
}

const ANNOTATION: Record<Severity, "error" | "warning" | "notice"> = { critical: "error", high: "error", medium: "warning", low: "notice" };

async function main() {
  const token = input("token") || process.env.RELEASESHIELD_TOKEN || "";
  if (token) process.stdout.write(`::add-mask::${token}\n`);

  const wd = input("working-directory");
  const cwd = wd ? path.resolve(process.env.GITHUB_WORKSPACE ?? process.cwd(), wd) : process.cwd();

  const failOnRaw = input("fail-on") || undefined;
  if (failOnRaw && !FAIL_LEVELS.includes(failOnRaw as FailOn)) throw new Error(`fail-on must be one of ${FAIL_LEVELS.join(", ")}`);
  const formatRaw = (input("format") || "text") as Format;
  if (!FORMATS.includes(formatRaw)) throw new Error(`format must be one of ${FORMATS.join(", ")}`);

  const result = await run({
    targets: list("artifact"),
    cwd,
    failOn: failOnRaw as FailOn | undefined,
    format: formatRaw,
    configPath: input("config") || undefined,
    ignore: list("ignore"),
    baseline: input("baseline") || undefined,
    registry: input("registry") || undefined,
    npmToken: input("npm-token") || process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN,
    token,
    slackWebhook: input("slack-webhook") || undefined,
    color: true,
    log: (m) => process.stdout.write(`${m}\n`),
  });

  process.stdout.write(result.output);
  const licensed = result.license.tier !== "free";
  const all = result.reports.flatMap((r) => r.findings.map((f) => ({ r, f })));

  if (licensed) {
    // Inline annotations on the workflow run
    for (const { r, f } of all.slice(0, 50)) {
      const title = escProp(`ReleaseShield: ${f.title}`);
      process.stdout.write(`::${ANNOTATION[f.severity]} title=${title}::${esc(`${r.target}: ${f.file}${f.line ? `:${f.line}` : ""}${f.evidence ? ` (${f.evidence})` : ""}. ${f.advice}`)}\n`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderMarkdown(result));

    const tmp = process.env.RUNNER_TEMP ?? cwd;
    const reportPath = path.join(tmp, "releaseshield-report.json");
    writeFileSync(reportPath, renderJson(result));
    setOutput("report-path", reportPath);
    const sarifOut = input("sarif-output");
    if (sarifOut) {
      const p = path.resolve(cwd, sarifOut);
      writeFileSync(p, renderSarif(result));
      setOutput("sarif-path", p);
    }
  } else if (input("sarif-output")) {
    process.stdout.write("::notice title=ReleaseShield::SARIF output requires a Standard or Pro license (set the token input).\n");
  }

  const worst = result.reports.reduce((w, r) => (r.score < w.score ? r : w), result.reports[0] ?? { score: 100, grade: "A" as const });
  setOutput("grade", worst.grade);
  setOutput("score", worst.score);
  setOutput("findings", all.length);
  setOutput("critical", result.reports.reduce((n, r) => n + r.counts.critical, 0));
  setOutput("failed", result.failed && result.enforced);
  setOutput("plan", result.license.tier);

  for (const e of result.errors) process.stdout.write(`::error title=ReleaseShield scan error::${esc(`${e.target}: ${e.message}`)}\n`);
  if (result.failed && result.enforced) {
    process.stdout.write(`::error title=ReleaseShield blocked this release::${esc(`Findings at or above "${result.failOn}" in the artifact. See the job summary.`)}\n`);
  }
  process.exitCode = result.exitCode;
}

main().catch((e) => {
  process.stdout.write(`::error title=ReleaseShield::${esc(e instanceof Error ? e.message : String(e))}\n`);
  process.exitCode = 2;
});
