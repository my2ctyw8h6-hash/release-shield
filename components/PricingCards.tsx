"use client";

import { useState } from "react";
import type { PublicPlan, PlanId } from "@/lib/plans";

export function PricingCards({ plans }: { plans: PublicPlan[] }) {
  const [loading, setLoading] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkout(plan: PlanId) {
    setLoading(plan);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok || typeof data.url !== "string") throw new Error(data.error ?? "Checkout unavailable.");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout unavailable.");
      setLoading(null);
    }
  }

  return (
    <>
      <div className="pricing-grid">
        <div className="card plan">
          <div className="plan-name">Free checker</div>
          <div className="plan-price">
            $0<span>/forever</span>
          </div>
          <p className="muted">Spot-check any public npm package or tarball.</p>
          <ul className="plan-features">
            <li>Unlimited one-off scans</li>
            <li>Source maps, .env, keys & tokens</li>
            <li>No login required</li>
          </ul>
          <a href="#check" className="btn btn-ghost">Run a free scan</a>
        </div>
        {plans.map((p) => (
          <div key={p.id} className={`card plan ${p.highlighted ? "plan-hl" : ""}`}>
            {p.highlighted && <div className="plan-badge">Most popular</div>}
            <div className="plan-name">{p.name}</div>
            <div className="plan-price">
              ${p.priceMonthly}
              <span>/month</span>
            </div>
            <p className="muted">{p.tagline}</p>
            <ul className="plan-features">
              {p.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
              {p.roadmap?.map((f) => (
                <li key={f} className="soon">
                  {f} <span className="soon-tag">Coming soon</span>
                </li>
              ))}
            </ul>
            <button className={`btn ${p.highlighted ? "btn-primary" : "btn-outline"}`} onClick={() => checkout(p.id)} disabled={loading !== null}>
              {loading === p.id ? <span className="spinner" aria-label="Loading" /> : `Start ${p.name}`}
            </button>
          </div>
        ))}
      </div>
      {error && <div className="alert center">{error}</div>}
      <p className="muted small center">Secure checkout by Stripe · Cancel anytime · Prices in USD</p>
    </>
  );
}
