export type PlanId = "standard" | "pro";

export interface Plan {
  id: PlanId;
  name: string;
  priceMonthly: number;
  lookupKey: string;
  tagline: string;
  features: string[];
  /** Planned features, shown separately and labelled "coming soon". Not yet built. */
  roadmap?: string[];
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
      "Use on up to 15 packages / images",
      "GitHub Action + CLI for GitLab, CircleCI & any CI",
      "npm, PyPI and Docker artifact scanning",
      "Fail-the-build on critical findings",
      "Slack alerts on critical & high findings",
      "JSON, SARIF & Markdown reports",
    ],
    roadmap: ["Hosted scan history"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceMonthly: 249,
    lookupKey: "release_shield_pro_monthly_usd_249",
    tagline: "For platform teams with many release pipelines",
    highlighted: true,
    features: [
      "Everything in Standard, unlimited packages & images",
      "Private npm registries (GitHub Packages, Artifactory & more)",
      "Custom policies: ignore files & rules per repo",
      "Diff vs. previous release: new files flagged",
      "Priority support",
    ],
    roadmap: ["Audit log & SOC 2 evidence export", "Hosted scan history"],
  },
};

export function isPlanId(v: unknown): v is PlanId {
  return v === "standard" || v === "pro";
}
