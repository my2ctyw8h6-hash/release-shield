const PRODUCTION_URL = "https://release-shield-app.vercel.app";

/** Normalize a base URL; reject junk like bare "https://vercel.app" (not our host, kills canonicals). */
function validBase(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase();
    if (host === "vercel.app" || host === "localhost" || !host.includes(".")) return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** Public base URL of the deployment, if known and sane. */
export function configuredSiteUrl(): string | null {
  return validBase(process.env.NEXT_PUBLIC_SITE_URL) ?? validBase(process.env.VERCEL_PROJECT_PRODUCTION_URL);
}

/** Canonical base URL; falls back to the production domain so OG/canonical URLs are never localhost or a foreign host. */
export const SITE_URL = configuredSiteUrl() ?? PRODUCTION_URL;

/** GitHub Action reference shown in docs/snippets (the repo that hosts action.yml, tag v1). */
export const ACTION_REF = process.env.NEXT_PUBLIC_GITHUB_ACTION_REF || "my2ctyw8h6-hash/release-shield@v1";

/** The CLI isn't on npm; the build copies the single-file bundle to public/releaseshield.mjs. */
export const CLI_URL = `${PRODUCTION_URL}/releaseshield.mjs`;
export const CLI_GET = `curl -fsSLo releaseshield.mjs ${CLI_URL}`;
