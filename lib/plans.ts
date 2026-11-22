export type PlanId = "standard" | "pro";

export interface Plan {
  id: PlanId;
  name: string;
  priceMonthly: number;
  /** Stable Stripe lookup key. Changing priceMonthly creates a new Price and moves this key to it. */
  lookupKey: string;
  /** Lookup keys from earlier price points, so existing subscribers still map to the right plan. */
  legacyLookupKeys?: string[];
  /** Plan limit on packages/repos protected (null = unlimited). */
  packageLimit: number | null;
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
    lookupKey: "release_shield_standard_monthly",
    legacyLookupKeys: ["release_shield_standard_monthly_usd_79"],
    packageLimit: 5,
    tagline: "For small teams shipping a few packages",
    features: [
      "Every release scanned before publish, not just once",
      "Up to 5 packages / repos",
      "GitHub Action + CLI for GitLab, CircleCI & any CI",
      "npm, PyPI and Docker artifact scanning",
      "Fail-the-build on critical findings",
      "Slack alerts on critical & high findings",
      "JSON, SARIF & Markdown reports",
    ],
    roadmap: ["24/7 tarball monitoring: we inspect every new version you publish to npm and alert you if a secret or .env slips in", "Hosted scan history"],
  },
  pro: {
    id: "pro",
    name: "Pro / Team",
    priceMonthly: 149,
    lookupKey: "release_shield_pro_monthly",
    legacyLookupKeys: ["release_shield_pro_monthly_usd_249"],
    packageLimit: null,
    tagline: "For teams with many packages & release pipelines",
    highlighted: true,
    features: [
      "Unlimited packages / repos",
      "Everything in Standard, plus:",
      "Private npm registries (GitHub Packages, Artifactory & more)",
      "Custom policies: ignore files & rules per repo",
      "Diff vs. previous release: new files flagged",
      "Priority support",
    ],
    roadmap: ["24/7 tarball monitoring: we inspect every new version you publish to npm and alert you if a secret or .env slips in", "Audit log & SOC 2 evidence export", "Hosted scan history"],
  },
};

/** Plan fields safe to send to the browser (no Stripe internals). */
export type PublicPlan = Omit<Plan, "lookupKey" | "legacyLookupKeys">;

export function toPublicPlan(plan: Plan): PublicPlan {
  const { lookupKey: _lookupKey, legacyLookupKeys: _legacy, ...rest } = plan;
  return rest;
}

export function isPlanId(v: unknown): v is PlanId {
  return v === "standard" || v === "pro";
}
