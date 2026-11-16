import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fetchNpmTarball } from "../../lib/npm";
import type { ScanSource } from "../../lib/scanner";

export interface LoadedTarget {
  data: Buffer;
  version?: string;
}

export interface ResolvedTarget {
  label: string;
  source: ScanSource;
  /** npm package name, when known (used for `--baseline auto`) */
  npmName?: string;
  load: () => Promise<LoadedTarget>;
}

export interface TargetOptions {
  registry?: string;
  npmToken?: string;
  maxBytes: number;
  log: (msg: string) => void;
}

const ARCHIVE_RE = /\.(tgz|tar\.gz|tar|whl|zip)$/i;
const IMAGE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,255}$/;
const isWin = process.platform === "win32";

export class Workspace {
  private dirs: string[] = [];
  tmp(): string {
    const d = mkdtempSync(path.join(tmpdir(), "releaseshield-"));
    this.dirs.push(d);
    return d;
  }
  cleanup() {
    for (const d of this.dirs) rmSync(d, { recursive: true, force: true });
    this.dirs = [];
  }
}

function readPkgName(dir: string): string | undefined {
  try {
    return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).name;
  } catch {
    return undefined;
  }
}

function npmPackTarget(dir: string, ws: Workspace, opts: TargetOptions): ResolvedTarget {
  const name = readPkgName(dir);
  return {
    label: name ?? path.basename(dir),
    source: "file",
    npmName: name,
    load: async () => {
      const out = ws.tmp();
      opts.log(`Running npm pack in ${dir} …`);
      try {
        execFileSync("npm", ["pack", "--pack-destination", out, "--silent"], { cwd: dir, stdio: ["ignore", "ignore", "inherit"], shell: isWin });
      } catch {
        throw new Error("`npm pack` failed (see output above).");
      }
      const tgz = readdirSync(out).find((f) => f.endsWith(".tgz"));
      if (!tgz) throw new Error("`npm pack` did not produce a tarball.");
      let version: string | undefined;
      try {
        version = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version;
      } catch {
        /* ignore */
      }
      return { data: readFileSync(path.join(out, tgz)), version };
    },
  };
}

function fileTarget(file: string, opts: TargetOptions): ResolvedTarget {
  return {
    label: file,
    source: "file",
    load: async () => {
      const size = statSync(file).size;
      if (size > opts.maxBytes) throw new Error(`${file} is larger than the ${Math.round(opts.maxBytes / 1024 / 1024)} MB limit.`);
      return { data: readFileSync(file) };
    },
  };
}

function expandGlob(pattern: string, cwd: string): string[] {
  const abs = path.resolve(cwd, pattern);
  const dir = path.dirname(abs);
  const base = path.basename(abs);
  if (/[*?]/.test(dir)) throw new Error(`Wildcards are only supported in the file name: ${pattern}`);
  if (!existsSync(dir)) return [];
  const re = new RegExp("^" + base.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  return readdirSync(dir)
    .filter((f) => re.test(f))
    .map((f) => path.join(dir, f))
    .filter((f) => statSync(f).isFile());
}

export function resolveTargets(specs: string[], cwd: string, ws: Workspace, opts: TargetOptions): ResolvedTarget[] {
  const out: ResolvedTarget[] = [];

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
        },
      });
    } else if (spec.startsWith("docker:")) {
      const image = spec.slice(7);
      if (!IMAGE_RE.test(image)) throw new Error(`Invalid image reference: ${image}`);
      out.push({
        label: image,
        source: "docker",
        load: async () => {
          const file = path.join(ws.tmp(), "image.tar");
          opts.log(`Exporting ${image} with docker save …`);
          try {
            execFileSync("docker", ["save", image, "-o", file], { stdio: ["ignore", "ignore", "inherit"], shell: isWin });
          } catch {
            throw new Error(`\`docker save ${image}\` failed. Is Docker running and the image built/pulled?`);
          }
          return fileTarget(file, opts).load();
        },
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
