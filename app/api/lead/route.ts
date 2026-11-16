import { NextResponse } from "next/server";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export async function POST(req: Request) {
  const rl = rateLimit(`lead:${clientIp(req)}`, 8, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Please enter a valid work email." }, { status: 400 });

  const lead = {
    email,
    company: typeof body?.company === "string" ? body.company.slice(0, 120) : undefined,
    scannedTarget: typeof body?.target === "string" ? body.target.slice(0, 220) : undefined,
    score: typeof body?.score === "number" ? body.score : undefined,
    findings: typeof body?.findings === "number" ? body.findings : undefined,
    source: "homepage-leak-checker",
    createdAt: new Date().toISOString(),
  };

  let stored = false;

  const webhook = process.env.LEAD_WEBHOOK_URL;
  if (webhook) {
    try {
      const r = await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(lead),
        signal: AbortSignal.timeout(5_000),
      });
      stored = r.ok;
    } catch (e) {
      console.error("[lead] webhook failed", e);
    }
  }

  // Local / self-hosted fallback (read-only filesystems on serverless will just skip this).
  try {
    const dir = path.join(process.cwd(), "data");
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, "leads.jsonl"), JSON.stringify(lead) + "\n");
    stored = true;
  } catch {
    /* ignore */
  }

  console.info("[lead] captured", { email: lead.email, target: lead.scannedTarget, stored });
  return NextResponse.json({ ok: true });
}
