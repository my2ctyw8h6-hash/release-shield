import { NextResponse } from "next/server";
import { fetchNpmTarball } from "@/lib/npm";
import { scanArchive, scanEntries, type ScanReport } from "@/lib/scanner";
import { SAMPLE_NAME, SAMPLE_VERSION, sampleEntries } from "@/lib/sample";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { cleanRef } from "@/lib/stats";
import { appendCountedEvent } from "@/lib/counted-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Keep uploads under common serverless body limits (e.g. Vercel's 4.5 MB).
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * /api/scan is unauthenticated, so it is counts-only: no file paths, line numbers or secret
 * evidence. Full detail comes from the CLI / Action, which scan locally. The demo package is fake, so it keeps detail.
 */
/** Count a scan only once it has completed, from the server, so button clicks
 * and forged beacons cannot inflate the funnel. Owner browsers are excluded. */
async function emitScanCompleted(req: Request, refRaw: unknown, path: string) {
  try {
    if ((req.headers.get("cookie") ?? "").includes("rs_owner=1")) return;
    const ref = cleanRef(typeof refRaw === "string" ? refRaw : new URL(req.url).searchParams.get("ref"));
    // One stable id for this event, shared by the log line and the durable gist
    // store so the counter dedupes the two paths against each other (item 17).
    const eventId = crypto.randomUUID();
    console.log(JSON.stringify({ rs_track: 1, id: eventId, src: "server", type: "scan_run", ref, path }));
    // Durable event store (item 17): awaited-with-catch — a failed write is
    // logged inside appendCountedEvent and never breaks the scan; the
    // log-window path still counts the event.
    await appendCountedEvent({
      id: eventId,
      type: "scan_run",
      ref,
      path,
      src: "server",
      createdAt: new Date().toISOString(),
    });
  } catch {
    /* counting must never break a scan */
  }
}

function redact(report: ScanReport) {
  return {
    ...report,
    redacted: true,
    findings: report.findings.map(({ ruleId, title, severity, advice, occurrences }) => ({ ruleId, title, severity, advice, occurrences })),
  };
}

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
      await emitScanCompleted(req, form.get("ref"), "/");
      return NextResponse.json(redact(report));
    }

    const body = (await req.json().catch(() => null)) as { package?: unknown; sample?: unknown; ref?: unknown } | null;
    if (body?.sample === true) {
      // Fake in-memory package for the homepage demo; runs the real scanner.
      const report = scanEntries(sampleEntries(), { target: SAMPLE_NAME, version: SAMPLE_VERSION, source: "npm" });
      return NextResponse.json({ ...report, sample: true });
    }
    const spec = typeof body?.package === "string" ? body.package : "";
    if (!spec.trim()) return NextResponse.json({ error: "Enter an npm package name." }, { status: 400 });

    const pkg = await fetchNpmTarball(spec);
    const report = scanArchive(pkg.data, { target: pkg.name, version: pkg.version, source: "npm" });
    await emitScanCompleted(req, body?.ref, "/npm/" + pkg.name);
    return NextResponse.json(redact(report));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed.";
    const status = /not found/i.test(message) ? 404 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
