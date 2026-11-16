const REGISTRY = "https://registry.npmjs.org";
const NAME_RE = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const VERSION_RE = /^[a-zA-Z0-9.+_-]{1,64}$/;
export const MAX_TARBALL_BYTES = 40 * 1024 * 1024;

export function parseSpec(input: string): { name: string; version: string } {
  const spec = input.trim().replace(/^npm\s+(i|install)\s+/, "").replace(/^https?:\/\/(www\.)?npmjs\.com\/package\//, "");
  const at = spec.lastIndexOf("@");
  const [name, version] = at > 0 ? [spec.slice(0, at), spec.slice(at + 1)] : [spec, "latest"];
  const lower = name.toLowerCase();
  if (!NAME_RE.test(lower) || lower.length > 214) throw new Error("That doesn't look like a valid npm package name.");
  if (!VERSION_RE.test(version)) throw new Error("Invalid version or tag.");
  return { name: lower, version };
}

interface Packument {
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, { dist?: { tarball?: string; unpackedSize?: number } }>;
}

export interface NpmFetchOptions {
  /** Registry base URL (default https://registry.npmjs.org) */
  registry?: string;
  /** Bearer token for private registries */
  token?: string;
  maxBytes?: number;
}

export async function fetchNpmTarball(spec: string, opts: NpmFetchOptions = {}): Promise<{ name: string; version: string; data: Buffer }> {
  const { name, version: requested } = parseSpec(spec);
  const registry = (opts.registry ?? REGISTRY).replace(/\/$/, "");
  const registryUrl = new URL(registry);
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(registryUrl.hostname);
  if (registryUrl.protocol !== "https:" && !isLocal) throw new Error("Registry must use https.");
  const auth: Record<string, string> = opts.token ? { authorization: `Bearer ${opts.token}` } : {};
  const maxBytes = opts.maxBytes ?? MAX_TARBALL_BYTES;
  const limitMsg = `Package is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB scan limit.`;
  const encoded = name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);

  const res = await fetch(`${registry}/${encoded}`, {
    headers: { accept: "application/vnd.npm.install-v1+json", ...auth },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (res.status === 404) throw new Error(`Package "${name}" was not found on npm.`);
  if (!res.ok) throw new Error(`npm registry returned ${res.status}.`);
  const doc = (await res.json()) as Packument;

  const version = doc["dist-tags"]?.[requested] ?? requested;
  const dist = doc.versions?.[version]?.dist;
  if (!dist?.tarball) throw new Error(`Version "${requested}" of ${name} was not found.`);

  const url = new URL(dist.tarball);
  // Only follow tarball URLs on the registry's own host, and only send credentials there.
  if (url.hostname !== registryUrl.hostname || (url.protocol !== "https:" && !isLocal)) throw new Error("Unexpected tarball location.");

  const tar = await fetch(url, { headers: auth, signal: AbortSignal.timeout(60_000), cache: "no-store" });
  if (!tar.ok || !tar.body) throw new Error(`Could not download tarball (${tar.status}).`);
  const declared = Number(tar.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error(limitMsg);

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = tar.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(limitMsg);
    }
    chunks.push(value);
  }
  return { name, version, data: Buffer.concat(chunks) };
}
