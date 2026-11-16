export type PlanId = "standard" | "pro";

export interface Plan {
  id: PlanId;
  name: string;
  priceMonthly: number;
  lookupKey: string;
  tagline: string;
  features: string[];
  highlighted?: boolean;
}

export const PLANS: Record<PlanId, Plan> = {
  standard: {
    id: "standard",
    name: "Standard",
    priceMonthly: 79,
    lookupKey: "release_shield_standard_monthly_usd_79",
    tagline: "For teams shipping a handful of packages",
    features: [
      "Up to 15 packages / images monitored",
      "CI plugin for GitHub Actions & GitLab CI",
      "npm, PyPI and Docker artifact scanning",
      "Fail-the-build on critical findings",
      "Slack & email alerts",
      "90-day scan history",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceMonthly: 249,
    lookupKey: "release_shield_pro_monthly_usd_249",
    tagline: "For platform teams with many release pipelines",
    highlighted: true,
    features: [
      "Unlimited packages, images & registries",
      "Private registries (GitHub Packages, Artifactory, ECR)",
      "Custom policies & allow/deny rules",
      "Diff vs. previous release: new files flagged",
      "Audit log & SOC 2 evidence export",
      "Unlimited history + priority support",
    ],
  },
};

export function isPlanId(v: unknown): v is PlanId {
  return v === "standard" || v === "pro";
}
