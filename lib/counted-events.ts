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
 *
 * P18 (Nov 25, 2026): the gist store is a read-modify-write PATCH, so two
 * concurrent appends can read the same base content and the second PATCH
 * silently clobbers the first (last-write-wins). The Nov 25 drill lost one
 * pageview exactly this way — a successful PATCH that never landed. Every
 * append now verifies after write (re-read, confirm the event id is present)
 * and retries once on fresh content if absent. A duplicate line with the same
 * id is harmless: track-cumulative dedupes by id.
 *
 * P20 (Nov 26, 2026): the P18 retry only covers a PATCH that SUCCEEDS but
 * whose verify re-read misses the id. Under a forced-concurrency burst the
 * failure is at the WRITE itself — GitHub 409s concurrent gist PATCHes, and
 * appendOnce throws before any verify runs, so nothing is retried (the Nov 26
 * P19 drill lost 4 of 6 events exactly this way). The write itself is now
 * retried once on fresh content after a short jittered backoff; the
 * verify-after-write stays as the second layer.
 *
 * P21 (Nov 26, 2026): one short-backoff retry is not a concurrency fix - a
 * 250-750ms backoff fires while the winning gist PATCHes are still landing
 * (~1s+ round-trip), so retries re-collide (the Nov 26 P20 drill: 2 of 4
 * retries 409d again). Backoff must exceed the write-settle time: the write
 * is now retried up to 2 times with exponential backoff (1s, 3s + jitter),
 * and every write attempt - initial and verify-retry - goes through the same
 * retrying helper, so a failed write is always retried and always logged.
 * The emission layer is fixed separately: /api/track awaits its append in the
 * request path instead of after(), whose callback can be dropped silently
 * under burst load (P20 drill lost one pageview with no log line at all, L8).
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

/** One read-modify-write PATCH attempt. Throws on read or write failure. */
async function appendOnce(cfg: { gistId: string; token: string }, ev: CountedEvent): Promise<void> {
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
}

/** Re-read the gist store and confirm this event id is present. */
async function eventPresent(cfg: { gistId: string; token: string }, id: string): Promise<boolean> {
  try {
    const content = await readEvents(cfg.gistId, cfg.token);
    return content.includes(`"id":"${id}"`);
  } catch {
    return false;
  }
}

// P21 (Nov 26, 2026): one short-backoff retry is not a concurrency fix -
// a 250-750ms backoff fires while the winning gist PATCHes are still landing
// (~1s+ round-trip), so retries re-collide (P20 drill: 2 of 4 retries 409d
// again). Backoff must exceed the write-settle time: up to 2 retries with
// exponential backoff (1s, 3s + jitter). Every write attempt - initial and
// verify-retry - goes through this helper, so a failed write is always
// retried and always logged (with the event id - the old final-failure line
// carried none, which made P20's two lost events mappable only by
// elimination).
/** One gist write with up to 2 retries on failure. Returns true if a PATCH succeeded. */
async function appendWithRetries(cfg: { gistId: string; token: string }, ev: CountedEvent): Promise<boolean> {
  const backoffsMs = [1000, 3000];
  for (let attempt = 0; attempt <= backoffsMs.length; attempt++) {
    try {
      await appendOnce(cfg, ev);
      return true;
    } catch (writeErr) {
      if (attempt === backoffsMs.length) {
        console.error("[counted-events] gist store failed", ev.id, writeErr);
        return false;
      }
      console.error("[counted-events] write failed, retrying append", ev.id, writeErr);
      await new Promise((r) => setTimeout(r, backoffsMs[attempt] + Math.random() * 500));
    }
  }
  return false;
}

/** Append one counted event to the gist store. Never throws; returns false on failure. */
export async function appendCountedEvent(ev: CountedEvent): Promise<boolean> {
  const cfg = gistConfig();
  if (!cfg) {
    await appendLocal(ev);
    return false;
  }
  // Write layer (P20+P21): retry the write itself on failure, up to 2 times
  // with exponential backoff. A duplicate line (if a PATCH actually landed
  // before its error surfaced) is harmless: track-cumulative dedupes by id.
  if (!(await appendWithRetries(cfg, ev))) {
    await appendLocal(ev);
    return false;
  }
  if (await eventPresent(cfg, ev.id)) {
    await appendLocal(ev);
    return true;
  }
  // The PATCH succeeded but the event is not in the store — a concurrent
  // append read the same base content and its PATCH won (last-write-wins).
  // Retry on fresh content; the retry's read includes the winner's event,
  // so nothing is lost twice.
  console.error("[counted-events] verify failed, retrying append", ev.id);
  if (!(await appendWithRetries(cfg, ev))) {
    await appendLocal(ev);
    return false;
  }
  if (await eventPresent(cfg, ev.id)) {
    await appendLocal(ev);
    return true;
  }
  console.error("[counted-events] verify failed after retry — event NOT in gist store", ev.id);
  await appendLocal(ev);
  return false;
}
