import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { addSubscriber } from "@/lib/subscribers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/**
 * Email capture for report-change alerts and the monthly leak digest.
 * Duplicates are accepted quietly (same { ok: true }, nothing stored twice);
 * malformed addresses get the same 400 the /api/lead route returns.
 */
export async function POST(req: Request) {
  const rl = rateLimit(`subscribe:${clientIp(req)}`, 8, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });
  }

  const source = typeof body?.source === "string" ? body.source.slice(0, 120) : "unknown";
  const result = await addSubscriber(email, source);
  console.info("[subscribe] captured", { email, source, result });
  return NextResponse.json({ ok: true });
}
