import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRIEFING_KEY = "derek-brief-9921";
const STATUS_URL =
  "https://gist.githubusercontent.com/my2ctyw8h6-hash/605539ebdbaea22d4bc2ba3ed87883bf/raw/studio-status.json";

const NO_STORE = { "cache-control": "no-store" };

/** Key-gated passthrough of the live studio-status.json gist. */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== BRIEFING_KEY) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  try {
    const res = await fetch(STATUS_URL, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502, headers: NO_STORE });
    }
    const data = await res.json();
    return NextResponse.json(data, { status: 200, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "upstream fetch failed" }, { status: 502, headers: NO_STORE });
  }
}
