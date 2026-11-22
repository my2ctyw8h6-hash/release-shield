import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { appendChargebackEvent } from "@/lib/chargeback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const REASONS = [
  "fraudulent",
  "product_not_received",
  "product_unacceptable",
  "subscription_canceled",
  "credit_not_processed",
  "unrecognized",
  "duplicate",
  "general",
];
const PRODUCT_TYPES = ["physical", "digital", "subscription", "unknown"];
const ORIGINS = ["https://lineanswered.com", "https://www.lineanswered.com"];

/**
 * Event intake for the free chargeback evidence checklist tool on
 * lineanswered.com. Cross-origin by design: the tool is a static page on
 * Cloudflare Pages; this route is its only server side. A "complete" event
 * is one generated checklist (the Dec 15 validation gate counts them,
 * deduped on the per-browser `bid`); an "email" event attaches the optional
 * template/reminder email to a completion id. No other personal data.
 */

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allow = ORIGINS.includes(origin) ? origin : ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: Request) {
  const headers = corsHeaders(req);
  const rl = rateLimit(`chargeback:${clientIp(req)}`, 12, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429, headers });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Bad request." }, { status: 400, headers });
  }

  if (body.type === "email") {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const id = typeof body.id === "string" ? body.id.slice(0, 64) : "";
    if (!EMAIL_RE.test(email) || !id) {
      return NextResponse.json(
        { error: "Please enter a valid email." },
        { status: 400, headers },
      );
    }
    const deadline =
      typeof body.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.deadline)
        ? body.deadline
        : undefined;
    const stored = await appendChargebackEvent({
      type: "email",
      id,
      email,
      deadline,
      createdAt: new Date().toISOString(),
    });
    console.info("[chargeback] email captured", { id, stored });
    return NextResponse.json({ ok: true }, { headers });
  }

  const reason =
    typeof body.reason === "string" && REASONS.includes(body.reason)
      ? body.reason
      : "general";
  const productType =
    typeof body.productType === "string" && PRODUCT_TYPES.includes(body.productType)
      ? body.productType
      : "unknown";
  const bid = typeof body.bid === "string" ? body.bid.slice(0, 64) : "";
  const id = randomUUID();
  const stored = await appendChargebackEvent({
    type: "complete",
    id,
    bid,
    reason,
    productType,
    hasTracking: body.hasTracking === true,
    hasComms: body.hasComms === true,
    createdAt: new Date().toISOString(),
  });
  console.info("[chargeback] completion", { id, reason, stored });
  return NextResponse.json({ ok: true, id }, { headers });
}
