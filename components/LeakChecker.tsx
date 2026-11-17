"use client";

import { useRef, useState } from "react";
import type { ScanReport, Finding } from "@/lib/scanner";
import { track } from "@/lib/track";

type Mode = "npm" | "upload";
const FREE_VISIBLE = 3;
const EXAMPLES = ["left-pad", "express", "@anthropic-ai/sdk", "lodash@4.17.21"];

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function FindingRow({ f, locked }: { f: Finding; locked: boolean }) {
  return (
    <li className={`finding ${locked ? "locked" : ""}`}>
      <span className={`sev sev-${f.severity}`}>{f.severity}</span>
      <div className="finding-body">
        <div className="finding-title">{f.title}</div>
        <code className="finding-file">
          {locked ? "•••••••/••••••••.•••" : f.file}
          {!locked && f.line ? `:${f.line}` : ""}
        </code>
        {!locked && f.evidence && <div className="finding-evidence">{f.evidence}</div>}
        {!locked && <div className="finding-advice">{f.advice}</div>}
      </div>
    </li>
  );
}

export function LeakChecker() {
  const [mode, setMode] = useState<Mode>("npm");
  const [pkg, setPkg] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [email, setEmail] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [leadState, setLeadState] = useState<"idle" | "sending" | "error">("idle");
  const resultsRef = useRef<HTMLDivElement>(null);

  async function runScan(e?: React.FormEvent, override?: string) {
    e?.preventDefault();
    track("scan_run");
    setError(null);
    setReport(null);
    setLoading(true);
    try {
      let res: Response;
      if (mode === "upload") {
        if (!file) throw new Error("Choose a .tgz file produced by `npm pack`.");
        const fd = new FormData();
        fd.append("file", file);
        res = await fetch("/api/scan", { method: "POST", body: fd });
      } else {
        const target = (override ?? pkg).trim();
        if (!target) throw new Error("Enter an npm package name.");
        res = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ package: target }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scan failed.");
      setReport(data as ScanReport);
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed.");
    } finally {
      setLoading(false);
    }
  }

  async function submitLead(e: React.FormEvent) {
    e.preventDefault();
    setLeadState("sending");
    try {
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          target: report ? `${report.target}${report.version ? "@" + report.version : ""}` : undefined,
          score: report?.score,
          findings: report?.findings.length,
        }),
      });
      if (!res.ok) throw new Error();
      setUnlocked(true);
      setLeadState("idle");
    } catch {
      setLeadState("error");
    }
  }

  const hidden = report && !unlocked ? Math.max(0, report.findings.length - FREE_VISIBLE) : 0;

  return (
    <div className="checker card" id="check">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={mode === "npm"} className={mode === "npm" ? "active" : ""} onClick={() => setMode("npm")}>
          npm package
        </button>
        <button role="tab" aria-selected={mode === "upload"} className={mode === "upload" ? "active" : ""} onClick={() => setMode("upload")}>
          Upload <code>npm pack</code> tarball
        </button>
      </div>

      <form onSubmit={runScan} className="checker-form">
        {mode === "npm" ? (
          <input
            className="input"
            placeholder="e.g. your-package or @scope/name@1.2.3"
            value={pkg}
            onChange={(e) => setPkg(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label="npm package name"
          />
        ) : (
          <label className="input file-input">
            <input type="file" accept=".tgz,.tar.gz,.tar,.whl,.zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <span>{file ? `${file.name} (${formatBytes(file.size)})` : "Choose a .tgz, .whl or .tar.gz (max 4 MB), scanned in memory, never stored"}</span>
          </label>
        )}
        <button className="btn btn-primary" disabled={loading}>
          {loading ? <span className="spinner" aria-label="Scanning" /> : "Scan for leaks"}
        </button>
      </form>

      {mode === "npm" && (
        <div className="examples">
          Try:{" "}
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              className="chip"
              type="button"
              onClick={() => {
                setPkg(ex);
                runScan(undefined, ex);
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      <p className="muted small">Free, no login. We scan the exact artifact a user would install, not your git repo.</p>

      {error && <div className="alert">{error}</div>}

      {report && (
        <div className="results" ref={resultsRef}>
          <div className="results-head">
            <div className={`grade grade-${report.grade}`}>{report.grade}</div>
            <div>
              <div className="results-target">
                {report.target}
                {report.version && <span className="muted">@{report.version}</span>}
              </div>
              <div className="muted small">
                {report.fileCount} files · {formatBytes(report.totalBytes)} unpacked · score {report.score}/100 · {report.durationMs} ms
              </div>
            </div>
          </div>

          <div className="counts">
            {(["critical", "high", "medium", "low"] as const).map((s) => (
              <div key={s} className={`count count-${s}`}>
                <strong>{report.counts[s]}</strong>
                <span>{s}</span>
              </div>
            ))}
          </div>

          {report.findings.length === 0 ? (
            <div className="clean">No leaks detected in this artifact. Keep it that way: add ReleaseShield to CI so every future release is checked automatically.</div>
          ) : (
            <ul className="findings">
              {report.findings.map((f, i) => (
                <FindingRow key={`${f.ruleId}-${f.file}-${i}`} f={f} locked={!unlocked && i >= FREE_VISIBLE} />
              ))}
            </ul>
          )}

          {!unlocked && (
            <form className="lead" onSubmit={submitLead}>
              <div>
                <strong>{hidden > 0 ? `Unlock ${hidden} more finding${hidden === 1 ? "" : "s"}` : "Get release-safety tips for your team"}</strong>
                <p className="muted small">
                  Leave your work email to see every finding. We&apos;ll occasionally follow up with tips on keeping secrets out of your releases.
                </p>
              </div>
              <div className="lead-row">
                <input className="input" type="email" required placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Work email" />
                <button className="btn btn-primary" disabled={leadState === "sending"}>
                  {leadState === "sending" ? "…" : hidden > 0 ? "Unlock report" : "Subscribe"}
                </button>
              </div>
              {leadState === "error" && <div className="alert small">Couldn&apos;t save that. Please check the email and try again.</div>}
            </form>
          )}
          {unlocked && (
            <div className="clean">
              Thanks! The full report is unlocked. To block leaks automatically, <a href="#pricing">add ReleaseShield to your CI →</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
