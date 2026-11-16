#!/usr/bin/env node
// Bundles the CLI and the GitHub Action into single, dependency-free ESM files.
import { build } from "esbuild";
import { chmodSync, readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("../cli/package.json", import.meta.url), "utf8"));
const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  legalComments: "none",
  define: { __CLI_VERSION__: JSON.stringify(version) },
  logLevel: "warning",
};

await build({ ...common, entryPoints: ["cli/src/bin.ts"], outfile: "cli/dist/releaseshield.mjs", banner: { js: "#!/usr/bin/env node" } });
chmodSync("cli/dist/releaseshield.mjs", 0o755);
await build({ ...common, entryPoints: ["action/src/index.ts"], outfile: "action/dist/index.mjs" });
console.log(`Built releaseshield CLI v${version} → cli/dist/releaseshield.mjs and action → action/dist/index.mjs`);
