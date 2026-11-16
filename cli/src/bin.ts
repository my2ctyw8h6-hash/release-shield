import { writeFileSync } from "node:fs";
import { run, FAIL_LEVELS, type FailOn } from "./core";
import { FORMATS, type Format } from "./format";
import { resolveLicense } from "./license-client";
import { VERSION } from "./version";

const HELP = `ReleaseShield ${VERSION}: catch leaks in the artifact you're about to publish.

Usage
  releaseshield [scan] [targets...] [options]
  releaseshield license            Show license status

Targets (default: npm pack the current package, or dist/*.whl|*.tar.gz)
  ./pkg-1.0.0.tgz  dist/*.whl      Local archives (.tgz .tar.gz .tar .whl .zip, docker save .tar)
  ./packages/foo                   A directory containing package.json (runs npm pack)
  npm:<name>[@version]             A published npm package
  docker:<image>[:tag]             A local Docker image (uses docker save)

Options
  --fail-on <level>     critical | high | medium | low | none (default: critical)   [Standard]
  --format <fmt>        text | json | sarif | markdown (default: text)              [Standard]
  -o, --output <file>   Write the report to a file instead of stdout
  --config <file>       Policy file (default: .releaseshield.json)                  [Pro/Team]
  --ignore <glob>       Skip files matching glob (repeatable)                       [Pro/Team]
  --ignore-rule <id>    Suppress a rule, e.g. source-map (repeatable)               [Pro/Team]
  --baseline <spec>     Diff vs previous release: auto | npm:<pkg>@<ver> | file     [Pro/Team]
  --registry <url>      npm registry for npm: targets (auth: NPM_TOKEN)             [Pro/Team]
  --slack-webhook <url> Alert Slack on critical/high findings                       [Standard]
  --token <token>       License token (default: $RELEASESHIELD_TOKEN)
  --no-color            Disable colored output
  -q, --quiet           Only print the report
  -h, --help            Show help
  -v, --version         Show version

Exit codes: 0 = pass, 1 = findings at/above --fail-on (licensed), 2 = scan error.
Without a license the CLI runs in free, report-only mode.\nPlans: Standard $19/mo (up to 5 packages/repos) · Pro/Team $49/mo (unlimited).
`;

class UsageError extends Error {}

function parse(argv: string[]) {
  const o = {
    command: "scan" as "scan" | "license" | "help" | "version",
    targets: [] as string[],
    failOn: undefined as FailOn | undefined,
    format: undefined as Format | undefined,
    output: undefined as string | undefined,
    config: undefined as string | undefined,
    ignore: [] as string[],
    ignoreRules: [] as string[],
    baseline: undefined as string | undefined,
    registry: undefined as string | undefined,
    slack: undefined as string | undefined,
    token: undefined as string | undefined,
    color: undefined as boolean | undefined,
    quiet: false,
  };
  const args = [...argv];
  if (args[0] === "scan") args.shift();
  else if (args[0] === "license") {
    args.shift();
    o.command = "license";
  }
  const value = (flag: string) => {
    const v = args.shift();
    if (v === undefined || (v.startsWith("-") && v.length > 1)) throw new UsageError(`${flag} requires a value`);
    return v;
  };
  while (args.length) {
    let a = args.shift()!;
    if (a.startsWith("--") && a.includes("=")) {
      const [k, ...rest] = a.split("=");
      args.unshift(rest.join("="));
      a = k;
    }
    switch (a) {
      case "-h":
      case "--help":
        o.command = "help";
        break;
      case "-v":
      case "--version":
        o.command = "version";
        break;
      case "--fail-on": {
        const v = value(a) as FailOn;
        if (!FAIL_LEVELS.includes(v)) throw new UsageError(`--fail-on must be one of: ${FAIL_LEVELS.join(", ")}`);
        o.failOn = v;
        break;
      }
      case "--format": {
        const v = value(a) as Format;
        if (!FORMATS.includes(v)) throw new UsageError(`--format must be one of: ${FORMATS.join(", ")}`);
        o.format = v;
        break;
      }
      case "-o":
      case "--output":
        o.output = value(a);
        break;
      case "--config":
        o.config = value(a);
        break;
      case "--ignore":
        o.ignore.push(value(a));
        break;
      case "--ignore-rule":
        o.ignoreRules.push(value(a));
        break;
      case "--baseline":
        o.baseline = value(a);
        break;
      case "--registry":
        o.registry = value(a);
        break;
      case "--slack-webhook":
        o.slack = value(a);
        break;
      case "--token":
        o.token = value(a);
        break;
      case "--no-color":
        o.color = false;
        break;
      case "-q":
      case "--quiet":
        o.quiet = true;
        break;
      default:
        if (a.startsWith("-")) throw new UsageError(`Unknown option: ${a}`);
        o.targets.push(a);
    }
  }
  return o;
}

async function main() {
  let o: ReturnType<typeof parse>;
  try {
    o = parse(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`error: ${e.message}\nRun \`releaseshield --help\` for usage.\n`);
      process.exit(2);
    }
    throw e;
  }
  if (o.command === "help") return void process.stdout.write(HELP);
  if (o.command === "version") return void process.stdout.write(`${VERSION}\n`);

  const token = o.token ?? process.env.RELEASESHIELD_TOKEN;
  const log = (m: string) => {
    if (!o.quiet || /^(warning|error)/.test(m)) process.stderr.write(`${m}\n`);
  };

  if (o.command === "license") {
    const l = await resolveLicense(token);
    process.stdout.write(`plan:   ${l.tier}\nstatus: ${l.status}\n${l.email ? `email:  ${l.email}\n` : ""}${l.message ? `note:   ${l.message}\n` : ""}`);
    process.exit(l.status === "invalid" || l.status === "inactive" ? 1 : 0);
  }

  const color = o.color ?? (!o.output && process.stdout.isTTY === true && !process.env.NO_COLOR);
  const result = await run({
    targets: o.targets,
    cwd: process.cwd(),
    failOn: o.failOn,
    format: o.format,
    configPath: o.config,
    ignore: o.ignore,
    ignoreRules: o.ignoreRules,
    baseline: o.baseline,
    registry: o.registry,
    npmToken: process.env.NPM_TOKEN ?? process.env.NODE_AUTH_TOKEN,
    token,
    slackWebhook: o.slack ?? process.env.RELEASESHIELD_SLACK_WEBHOOK,
    color,
    log,
  });

  if (o.output) {
    writeFileSync(o.output, result.output);
    log(`Report written to ${o.output}`);
    if (result.format !== "text") process.stderr.write(result.failed && result.enforced ? "✖ Release blocked by ReleaseShield\n" : "✓ ReleaseShield passed\n");
  } else process.stdout.write(result.output);
  process.exitCode = result.exitCode;
}

main().catch((e) => {
  process.stderr.write(`error: ${e instanceof Error ? e.message : e}\n`);
  process.exit(2);
});
