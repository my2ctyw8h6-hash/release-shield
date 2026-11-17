/** Public base URL of the deployment, if known. */
export function configuredSiteUrl(): string | null {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return null;
}

/** Canonical base URL; falls back to the production domain so OG/canonical URLs are never localhost. */
export const SITE_URL = configuredSiteUrl() ?? "https://release-shield-app.vercel.app";

/** GitHub Action reference shown in docs/snippets (the repo that hosts action.yml). */
export const ACTION_REF = process.env.NEXT_PUBLIC_GITHUB_ACTION_REF ?? "releaseshield/release-shield@v1";
