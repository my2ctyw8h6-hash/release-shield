# releaseshield

Scan the artifact you're about to publish (npm tarball, Python wheel/sdist, Docker image) for source maps, `.env` files, keys, tokens and internal files, and block the release in CI.

```bash
npx releaseshield scan                      # npm pack the current package and scan it
npx releaseshield scan dist/*.whl           # Python
npx releaseshield scan docker:my-app:1.4.0  # Docker (needs docker CLI)
npx releaseshield scan npm:some-pkg@2.0.0   # published npm version
RELEASESHIELD_TOKEN=rs_… npx releaseshield scan --fail-on high --format sarif -o report.sarif
```

Without `RELEASESHIELD_TOKEN` it runs in free, report-only mode (always exits 0 unless the scan errors).
Standard ($79/mo, up to 5 packages/repos) unlocks `--fail-on` enforcement, json/sarif/markdown output and Slack alerts. Pro / Team ($149/mo, unlimited) adds policies (`--ignore`, `--ignore-rule`, `.releaseshield.json`), `--baseline` release diffs and private registries.

Exit codes: `0` pass · `1` release blocked · `2` scan error. Run `releaseshield --help` for every option.

Why `.npmignore` leaks: once it exists, npm stops reading `.gitignore`, so anything you didn't re-list ships. Details and the `files` allowlist fix: https://releaseshield.lineanswered.com/guides/npmignore-trap?ref=npm
