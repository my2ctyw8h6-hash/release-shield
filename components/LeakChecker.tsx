"use client";

import { useEffect, useRef, useState } from "react";
import type { ScanReport, PublicScanFinding as Finding } from "@/lib/scanner";
import { currentRef } from "@/lib/track";
import { buildFix, fixTargetFor } from "@/lib/remediation";
import { FixPanel } from "./FixPanel";
import { CopyBox } from "./CopyBox";

type Mode = "npm" | "upload";
const FREE_VISIBLE = 3;
const EXAMPLES = ["left-pad", "express", "@anthropic-ai/sdk", "lodash@4.17.21"];

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** README badge; the link reruns a live scan of the package. Scoped names keep their slash (catch-all route). */
function badgeMarkdown(name: string) {
  const origin = window.location.origin;
  const path = name.split("/").map(encodeURIComponent).join("/");
  return `[![ReleaseShield](${origin}/api/badge/npm/${path}.svg)](${origin}/?scan=${encodeURIComponent(name)})`;
}

function FindingRow({ f, locked }: { f: Finding; locked: boolean }) {
  return (
    <li className={`finding ${locked ? "locked" : ""}`}>
      <span className={`sev sev-${f.severity}`}>{f.severity}</span>
      <div className="finding-body">
        <div className="finding-title">{f.title}</div>
        {(locked || f.file) && (
          <code className="finding-file">
            {locked ? "•••••••/••••••••.•••" : f.file}
            {!locked && f.line ? `:${f.line}` : ""}
          </code>
        )}
        {!locked && f.occurrences && f.occurrences > 1 && !f.file && <div className="finding-evidence">{f.occurrences} files</div>}
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
  const [report, setReport] = useState<(Omit<ScanReport, "findings"> & { findings: Finding[]; sample?: boolean; redacted?: boolean }) | null>(null);
  const [email, setEmail] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [leadState, setLeadState] = useState<"idle" | "sending" | "error">("idle");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Deep link from /npm/<pkg> report pages: /?scan=<pkg> runs a live scan on load.
  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get("scan");
    if (target) {
      setPkg(target);
      void runScan(undefined, target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runScan(e?: React.FormEvent, override?: string, sample = false) {
    e?.preventDefault();
    setError(null);
    setReport(null);
    setLoading(true);
    try {
      let res: Response;
      if (sample) {
        res = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sample: true, ref: currentRef() }),
        });
      } else if (mode === "upload") {
        if (!file) throw new Error("Choose a .tgz file produced by `npm pack`.");
        const fd = new FormData();
        fd.append("file", file);
        fd.append("ref", currentRef() ?? "");
        res = await fetch("/api/scan", { method: "POST", body: fd });
      } else {
        const target = (override ?? pkg).trim();
        if (!target) throw new Error("Enter an npm package name.");
        res = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ package: target, ref: currentRef() }),
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

  // Item 12: pay prompt at the value moment - direct checkout start after a
  // critical/high finding, reusing the PricingCards /api/checkout contract.
  async function startCheckout() {
    setCheckoutLoading(true);
    setCheckoutError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: "pro", ref: currentRef() }),
      });
      const data = await res.json();
      if (!res.ok || typeof data.url !== "string") throw new Error(data.error ?? "Checkout unavailable.");
      window.location.href = data.url;
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : "Checkout unavailable.");
      setCheckoutLoading(false);
    }
  }

  const hasBlockingFinding = !!report?.findings.some((f) => f.severity === "critical" || f.severity === "high");

  // The demo package is fake, so show everything and skip the email gate.
  const open = unlocked || !!report?.sample;
  const hidden = report && !open ? Math.max(0, report.findings.length - FREE_VISIBLE) : 0;

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
          <button
            className="chip chip-demo"
            type="button"
            disabled={loading}
            onClick={() => {
              setPkg("");
              runScan(undefined, undefined, true);
            }}
          >
            Scan a leaky demo package
          </button>
          Real ones:{" "}
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
            <div className="clean">
              No leaks detected in this artifact. Keep it that way: add ReleaseShield to CI so every future release is checked automatically.
              {report.source === "npm" && !report.sample && (
                <div className="badge-snippet">
                  <p className="small">
                    Clean tarball. Put it in your README:{" "}
                    <img src={`/api/badge/npm/${report.target}.svg`} alt="ReleaseShield: clean tarball" height={20} style={{ verticalAlign: "middle" }} />
                  </p>
                  <CopyBox label="README badge Markdown" value={badgeMarkdown(report.target)} />
                </div>
              )}
            </div>
          ) : (
            <ul className="findings">
              {report.findings.map((f, i) => (
                <FindingRow key={`${f.ruleId}-${i}`} f={f} locked={!open && i >= FREE_VISIBLE} />
              ))}
            </ul>
          )}

          {report.redacted && report.findings.length > 0 && (
            <p className="small muted">
              The web scan shows rule categories and counts only. Run the CLI locally (<code>npx releaseshield</code>) for exact file paths and line numbers.
            </p>
          )}

          {report.findings.length > 0 && (
            <>
              <FixPanel
                title={hidden > 0 ? `Fix it (covers the ${FREE_VISIBLE} visible findings; unlock below for the other ${hidden})` : "Fix it"}
                fix={buildFix(open ? report.findings : report.findings.slice(0, FREE_VISIBLE), fixTargetFor(report.kind, report.source))}
              />
              <p className="small muted">
                The ignore file fixes this release. To stop it coming back, <a href="#pricing">fail the publish in CI</a> when a new leak shows up.
              </p>
              {hasBlockingFinding && (
                <div style={{ marginTop: 12 }}>
                  <button className="btn btn-primary" onClick={startCheckout} disabled={checkoutLoading}>
                    {checkoutLoading ? "…" : "Block this in CI — start Pro · $149/mo"}
                  </button>
                  {checkoutError && <div className="alert small">{checkoutError}</div>}
                  <p className="small muted">Secure checkout by Stripe · Cancel anytime</p>
                </div>
              )}
            </>
          )}

          {report.sample && (
            <div className="clean">
              That was a fake package (<code>{report.target}</code>, built in memory, never published). Your real tarball is what matters:{" "}
              <a
                href="#check"
                onClick={() => {
                  setReport(null);
                  setPkg("");
                }}
              >
                scan your package
              </a>{" "}
              or run <code>npm pack</code> and upload the <code>.tgz</code>. To block these at publish time, see{" "}
              <a href="#pricing">CI plans</a>.
            </div>
          )}
          {!open && (
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
          {unlocked && !report.sample && (
            <div className="clean">
              Thanks! The full report is unlocked. To block leaks automatically, <a href="#pricing">add ReleaseShield to your CI →</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
