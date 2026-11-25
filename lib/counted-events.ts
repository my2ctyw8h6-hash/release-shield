import "server-only";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Durable funnel-event store (item 17, A7).
 *
 * The counter (/root/track-cumulative.js) reads the last 25 min of Vercel
 * runtime logs (30-min retention). A counter outage longer than ~5 min lets
 * events age out of the logs before they are ever counted. This file is the
 * recovery source: every counted event is ALSO written here, at EMISSION time
 * in the app, so a later counter run can backfill anything the log window
 * missed. (Writing at count time would not pass the drill's own signal: a
 * 40-min counter outage lets events age past log retention BEFORE any
 * count-time write happens.)
 *
 * Store: `counted-events.jsonl` in the briefing gist (BRIEFING_GIST_ID /
 * BRIEFING_GH_TOKEN), one JSON object per line, append-only — mirroring
 * lib/subscribers.ts / lib/chargeback.ts. A local data/ append runs as a
 * best-effort mirror. Writes never throw and never break the request:
 * failure is logged and the log-window path still counts the event.
 *
 * Event shape (matches the rs_track log line, plus a stable id for dedupe):
 *   { id, type, ref, plan?, path?, src?, createdAt }
 * `id` is a UUID minted at emission and logged in the rs_track line too, so
 * the log path and the gist path dedupe on the same id in track-cumulative.
 * Only server-witnessed events are written (pageview from /api/track,
 * scan_run from /api/scan emitScanCompleted, checkout_started from
 * /api/checkout) — the same discipline as the log path.
 */

const EVENTS_FILE = "counted-events.jsonl";

export interface CountedEvent {
  id: string;
  type: string;
  ref?: string;
  plan?: string;
  path?: string;
  src?: string;
  createdAt: string;
}

function gistConfig(): { gistId: string; token: string } | null {
  const gistId = process.env.BRIEFING_GIST_ID;
  const token = process.env.BRIEFING_GH_TOKEN;
  return gistId && token ? { gistId, token } : null;
}

async function readEvents(gistId: string, token: string): Promise<string> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };
  const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`gist read ${res.status}`);
  const data = await res.json();
  const file = data?.files?.[EVENTS_FILE];
  if (!file) return "";
  let content: string = file.content ?? "";
  if (file.truncated && file.raw_url) {
    const raw = await fetch(file.raw_url, { headers, cache: "no-store" });
    if (!raw.ok) throw new Error(`gist raw ${raw.status}`);
    content = await raw.text();
  }
  return content;
}

async function appendLocal(ev: CountedEvent): Promise<void> {
  try {
    const dir = path.join(process.cwd(), "data");
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, EVENTS_FILE), JSON.stringify(ev) + "\n");
  } catch {
    /* read-only filesystems just skip this */
  }
}

/** Append one counted event to the gist store. Never throws; returns false on failure. */
export async function appendCountedEvent(ev: CountedEvent): Promise<boolean> {
  const cfg = gistConfig();
  if (!cfg) {
    await appendLocal(ev);
    return false;
  }
  try {
    const existing = await readEvents(cfg.gistId, cfg.token);
    const content = existing && !existing.endsWith("\n") ? existing + "\n" : existing;
    const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(cfg.gistId)}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: "application/vnd.github+json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        files: { [EVENTS_FILE]: { content: content + JSON.stringify(ev) + "\n" } },
      }),
    });
    if (!res.ok) throw new Error(`gist write ${res.status}`);
    await appendLocal(ev);
    return true;
  } catch (e) {
    console.error("[counted-events] gist store failed", e);
    await appendLocal(ev);
    return false;
  }
}
