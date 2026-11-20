import type { Severity } from "./rules";

/** A finding that is safe to publish (harmless hygiene categories only; see scripts/seo-crawl.ts). */
export interface PublicFinding {
  ruleId: string;
  title: string;
  severity: Severity;
  file: string;
  occurrences: number;
  advice: string;
}

export interface NpmReport {
  name: string;
  version: string;
  description: string;
  /** null = npm API gave no figure (never a fabricated 0). */
  weeklyDownloads: number | null;
  grade: "A" | "B" | "C" | "D" | "F";
  score: number;
  fileCount: number;
  totalBytes: number;
  counts: Record<Severity, number>;
  findings: PublicFinding[];
  /** Findings (secret patterns / sensitive files) intentionally not published. Count only. */
  withheld: number;
  scannedAt: string;
}

export interface ReportsFile {
  generatedAt: string;
  reports: Record<string, NpmReport>;
}
