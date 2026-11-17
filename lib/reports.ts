import data from "@/content/npm-reports.json";
import type { NpmReport, ReportsFile } from "./reports-types";
import { configuredSiteUrl } from "./site";

const db = data as unknown as ReportsFile;

export const SITE_URL = configuredSiteUrl() ?? "https://release-shield-app.vercel.app";

export function allReports(): NpmReport[] {
  return Object.values(db.reports);
}

export function getReport(name: string): NpmReport | undefined {
  return db.reports[name];
}

export function reportsGeneratedAt(): string {
  return db.generatedAt;
}

/** "@scope/name" → ["@scope", "name"] for catch-all routes. */
export function slugFor(name: string): string[] {
  return name.split("/");
}

export function reportPath(name: string): string {
  return `/npm/${name}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatNum(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: n >= 10_000 ? "compact" : "standard" }).format(n);
}
