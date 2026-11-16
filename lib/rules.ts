export type Severity = "critical" | "high" | "medium" | "low";

export interface PathRule {
  id: string;
  title: string;
  severity: Severity;
  test: (path: string, base: string) => boolean;
  advice: string;
}

export interface ContentRule {
  id: string;
  title: string;
  severity: Severity;
  pattern: RegExp;
  advice: string;
}

const envExample = /\.(example|sample|template|dist|defaults?)$/i;

export const PATH_RULES: PathRule[] = [
  {
    id: "env-file",
    title: "Environment file shipped",
    severity: "critical",
    test: (_p, b) => /^\.env(\..+)?$/i.test(b) && !envExample.test(b),
    advice: "Add .env* to .npmignore or use an explicit \"files\" allowlist in package.json. Rotate every value in it.",
  },
  {
    id: "private-key-file",
    title: "Private key / certificate bundle",
    severity: "critical",
        // .pem/.crt are usually public certs; PEM private keys are caught by the content rule instead.
    test: (_p, b) => /\.(key|p12|pfx|jks|keystore|ppk)$/i.test(b) || /^id_(rsa|dsa|ecdsa|ed25519)$/i.test(b),
    advice: "Remove the key from the artifact and revoke/rotate it immediately.",
  },
  {
    id: "credentials-file",
    title: "Credentials / auth config file",
    severity: "high",
    test: (_p, b) => /^(\.npmrc|\.pypirc|\.netrc|\.htpasswd|credentials(\.json)?|service-account.*\.json|\.dockercfg|config\.json\.bak)$/i.test(b),
    advice: "Registry and cloud auth files should never be published. Exclude them and rotate tokens.",
  },
  {
    id: "source-map",
    title: "Source map published",
    severity: "medium",
    test: (_p, b) => /\.(js|mjs|cjs|css|ts)\.map$/i.test(b),
    advice: "Source maps expose original file names and structure, and can reconstruct source. Strip *.map from release builds or upload them privately to your error tracker.",
  },
  {
    id: "git-dir",
    title: "Git metadata included",
    severity: "high",
    test: (p) => /(^|\/)\.git\//.test(p) || /(^|\/)\.git$/.test(p),
    advice: "A .git directory can expose full history, remotes and unreleased branches.",
  },
  {
    id: "database-dump",
    title: "Database file or dump",
    severity: "high",
    test: (_p, b) => /\.(sqlite3?|db|sql|dump|bak\.sql)$/i.test(b),
    advice: "Database files frequently contain customer or internal data. Exclude them from releases.",
  },
  {
    id: "internal-docs",
    title: "Internal documentation",
    severity: "medium",
    // Only documents. `src/internal/*.js` style code folders are normal in SDKs.
    test: (p, b) =>
      (/\.(md|mdx|txt|pdf|docx?|pptx?|xlsx?|rtf|html?)$/i.test(b) &&
        !/^(README|LICEN[CS]E|CHANGELOG|HISTORY|NOTICE|CONTRIBUTING|SECURITY)(\.|$)/i.test(b) &&
        /(^|\/)(internal|private|confidential|secret)s?(\/|[-_.])/i.test(p)) ||
      /^(ROADMAP|INTERNAL|TODO-internal)\.md$/i.test(b),
    advice: "Roadmaps and internal docs can reveal unreleased features. Keep them out of the package.",
  },
  {
    id: "log-file",
    title: "Log file",
    severity: "medium",
    test: (_p, b) => /\.log$/i.test(b) || /^npm-debug\.log/i.test(b),
    advice: "Logs can contain tokens, file paths and stack traces from your build machine.",
  },
  {
    id: "backup-file",
    title: "Backup / editor temp file",
    severity: "medium",
    test: (_p, b) => /(\.(bak|orig|old|swp|swo|tmp)|~)$/i.test(b),
    advice: "Backup files often hold stale secrets or unreviewed code.",
  },
  {
    id: "archive-in-archive",
    title: "Nested archive",
    severity: "medium",
    test: (_p, b) => /\.(zip|tar|tgz|tar\.gz|7z|rar)$/i.test(b),
    advice: "Nested archives are often accidental build artifacts. Verify they are intended.",
  },
  {
    id: "test-coverage",
    title: "Coverage / test output",
    severity: "low",
    test: (p) => /(^|\/)(coverage|\.nyc_output|__snapshots__|test-results)\//.test(p),
    advice: "Coverage output bloats the package and can embed full source.",
  },
  {
    id: "ide-config",
    title: "IDE / OS metadata",
    severity: "low",
    test: (p, b) => /(^|\/)(\.vscode|\.idea)\//.test(p) || b === ".DS_Store" || b === "Thumbs.db",
    advice: "Editor and OS files leak local paths and usernames.",
  },
  {
    id: "ci-config",
    title: "CI / infra configuration",
    severity: "low",
    test: (p, b) => /(^|\/)(\.github\/workflows|\.gitlab|\.circleci)\//.test(p) || /^\.gitlab-ci\.ya?ml$/.test(b) || /^(docker-compose.*\.ya?ml|terraform\.tfvars|.*\.tfstate)$/i.test(b),
    advice: "Infra config can reveal internal hostnames, account IDs and deployment topology.",
  },
];

export const CONTENT_RULES: ContentRule[] = [
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
  { id: "internal-host", title: "Internal hostname / private IP URL", severity: "low", pattern: /\b(?:https?|wss?|grpc|tcp):\/\/(?:(?:[a-z0-9-]+\.)+(?:internal|corp|lan)\b|(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3})/i, advice: "Internal endpoints help attackers map your infrastructure." },
];

export const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 40, high: 15, medium: 6, low: 2 };
export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];
