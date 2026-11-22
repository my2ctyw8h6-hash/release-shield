"use client";

import { useState } from "react";

/**
 * Email capture in the same visual language as the LeakChecker lead form
 * (.lead / .lead-row / .input). Used on the homepage (monthly leak digest)
 * and on per-package report pages (report-change alerts).
 */
export function SubscribeForm({
  heading,
  blurb,
  source,
  buttonLabel = "Notify me",
}: {
  heading: string;
  blurb: string;
  source: string;
  buttonLabel?: string;
}) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, source }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="lead">
        <strong>{heading}</strong>
        <p className="muted small">You&apos;re on the list — we&apos;ll email {email} when there&apos;s something worth reporting. No spam, unsubscribe anytime.</p>
      </div>
    );
  }

  return (
    <form className="lead" onSubmit={submit}>
      <strong>{heading}</strong>
      <p className="muted small">{blurb}</p>
      <div className="lead-row">
        <input
          type="email"
          className="input"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          spellCheck={false}
          aria-label="Email address"
        />
        <button type="submit" className="btn btn-primary" disabled={state === "sending"}>
          {state === "sending" ? "…" : buttonLabel}
        </button>
      </div>
      {state === "error" && <p className="small" style={{ color: "#fca5a5" }}>That didn&apos;t go through — check the address and try again.</p>}
    </form>
  );
}
