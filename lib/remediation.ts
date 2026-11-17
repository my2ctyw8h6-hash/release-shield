/**
 * Turn scan findings into a copy-paste fix: ignore-file lines, a verify command,
 * and a rotation checklist for anything that looked like a live secret.
 * Pure function, safe for client and server components.
 */

export type FixTarget = "npm" | "python" | "docker";

/** Ignore globs per path rule. Content (secret-pattern) rules have none: the fix is rotation. */
const IGNORE: Record<string, { globs: string[]; why: string }> = {
  "env-file": { globs: [".env", ".env.*", "!.env.example"], why: "environment files" },
  "private-key-file": { globs: ["*.key", "*.p12", "*.pfx", "*.jks", "*.keystore", "*.ppk", "id_rsa*", "id_ed25519*"], why: "private keys" },
  "credentials-file": { globs: [".npmrc", ".pypirc", ".netrc", "credentials*.json", "service-account*.json"], why: "auth configs" },
  "source-map": { globs: ["*.map"], why: "source maps" },
  "git-dir": { globs: [".git/"], why: "git metadata" },
  "database-dump": { globs: ["*.sqlite", "*.sqlite3", "*.db", "*.sql", "*.dump"], why: "database files" },
  "internal-docs": { globs: ["internal/", "ROADMAP.md"], why: "internal docs" },
  "log-file": { globs: ["*.log"], why: "logs" },
  "backup-file": { globs: ["*.bak", "*.orig", "*.swp", "*~"], why: "backup files" },
  "archive-in-archive": { globs: ["*.tgz", "*.zip"], why: "nested archives" },
  "test-coverage": { globs: ["coverage/", ".nyc_output/", "__snapshots__/", "test-results/"], why: "test output" },
  "ide-config": { globs: [".vscode/", ".idea/", ".DS_Store"], why: "editor files" },
  "ci-config": { globs: [".github/", ".gitlab-ci.yml", ".circleci/", "docker-compose*.yml", "*.tfstate", "*.tfvars"], why: "CI/infra config" },
};

export interface Fix {
  /** File to paste into, e.g. ".npmignore". */
  file: string;
  /** Ready-to-append contents of that file. Empty when no path rule matched. */
  ignore: string;
  /** Shell command that lists what would ship, filtered to the flagged patterns. */
  verify: string;
  /** Extra caveats specific to the target. */
  notes: string[];
  /** Titles of secret-pattern findings that need rotating, deduped. */
  rotate: string[];
}

const FILE: Record<FixTarget, string> = { npm: ".npmignore", python: "MANIFEST.in", docker: ".dockerignore" };

function globToGrep(g: string): string {
  return g
    .replace(/^!.*/, "")
    .replace(/[.+^$()|[\]{}]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\/$/, "/");
}

export function buildFix(findings: { ruleId: string; title: string }[], target: FixTarget = "npm"): Fix {
  const ids = [...new Set(findings.map((f) => f.ruleId))];
  const sections = ids.filter((id) => IGNORE[id]).map((id) => IGNORE[id]);
  const rotate = [...new Set(findings.filter((f) => !IGNORE[f.ruleId]).map((f) => f.title))];

  const lines: string[] = [];
  for (const s of sections) {
    lines.push(`# ${s.why}`);
    for (const g of s.globs) {
      if (target === "python") {
        if (g.startsWith("!")) continue;
        lines.push(g.endsWith("/") ? `prune ${g.slice(0, -1)}` : `global-exclude ${g}`);
      } else {
        lines.push(g);
      }
    }
  }

  const pattern = sections
    .flatMap((s) => s.globs)
    .map(globToGrep)
    .filter(Boolean)
    .map((p) => (p.endsWith("/") ? `(^|/)${p}` : `(^|/)${p}$`))
    .join("|");

  const list =
    target === "npm"
      ? "npm pack --dry-run --json | jq -r '.[0].files[].path'"
      : target === "python"
        ? "python -m build --wheel && unzip -Z1 dist/*.whl"
        : "docker build -t tmp . && docker run --rm --entrypoint find tmp / -xdev -type f";
  const keep = sections
    .flatMap((s) => s.globs)
    .filter((g) => g.startsWith("!"))
    .map((g) => `(^|/)${globToGrep(g.slice(1))}$`)
    .join("|");
  const verify = pattern
    ? `${list} | grep -E '${pattern}'${keep ? ` | grep -vE '${keep}'` : ""} || echo "clean"`
    : list;

  const notes: string[] = [];
  if (target === "npm") {
    notes.push(
      `If package.json has a "files" field, npm ignores .npmignore. Narrow "files" instead, e.g. "files": ["dist", "!dist/**/*.map"].`,
      "A new .npmignore replaces .gitignore for npm. Copy over anything from .gitignore you still want excluded.",
    );
    if (ids.includes("source-map")) notes.push(`Or stop emitting maps for release builds: "sourceMap": false in tsconfig, or your bundler's equivalent.`);
  }
  if (target === "python") notes.push("MANIFEST.in controls sdists. For wheels, also check [tool.setuptools.packages.find] exclude / your build backend's include rules.");

  return { file: FILE[target], ignore: lines.join("\n"), verify, notes, rotate };
}

export function fixTargetFor(kind: string | undefined, source?: string): FixTarget {
  if (source === "docker" || kind === "docker") return "docker";
  if (kind === "zip") return "python";
  return "npm";
}
