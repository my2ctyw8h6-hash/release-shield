import { NextResponse } from "next/server";
import { fetchNpmTarball } from "@/lib/npm";
import { scanArchive } from "@/lib/scanner";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Keep uploads under common serverless body limits (e.g. Vercel's 4.5 MB).
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  const rl = rateLimit(`scan:${clientIp(req)}`, 12, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many scans. Try again in ${rl.retryAfter}s.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  try {
    const type = req.headers.get("content-type") ?? "";

    if (type.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
      if (file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: "Upload is larger than 4 MB. Scan it by npm name instead, or use the CLI." }, { status: 413 });
      }
      if (!/\.(tgz|tar\.gz|tar|whl|zip)$/i.test(file.name)) {
        return NextResponse.json({ error: "Upload a .tgz from `npm pack`, a Python wheel/sdist, or a .tar / .zip." }, { status: 400 });
      }
      const data = Buffer.from(await file.arrayBuffer());
      const report = scanArchive(data, { target: file.name, source: "upload" });
      return NextResponse.json(report);
    }

    const body = (await req.json().catch(() => null)) as { package?: unknown } | null;
    const spec = typeof body?.package === "string" ? body.package : "";
    if (!spec.trim()) return NextResponse.json({ error: "Enter an npm package name." }, { status: 400 });

    const pkg = await fetchNpmTarball(spec);
    const report = scanArchive(pkg.data, { target: pkg.name, version: pkg.version, source: "npm" });
    return NextResponse.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed.";
    const status = /not found/i.test(message) ? 404 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
