/** Public base URL of the deployment, if known. */
export function configuredSiteUrl(): string | null {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return null;
}

/** GitHub Action reference shown in docs/snippets (the repo that hosts action.yml). */
export const ACTION_REF = process.env.NEXT_PUBLIC_GITHUB_ACTION_REF ?? "releaseshield/release-shield@v1";
