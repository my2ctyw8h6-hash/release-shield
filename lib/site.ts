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

/** GitHub Action reference shown in docs/snippets (the repo that hosts action.yml). */
export const ACTION_REF = process.env.NEXT_PUBLIC_GITHUB_ACTION_REF ?? "releaseshield/release-shield@v1";
