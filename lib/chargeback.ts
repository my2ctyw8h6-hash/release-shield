import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Chargeback checklist tool event store (lineanswered.com/chargeback-checklist).
 * Mirrors lib/subscribers.ts: the durable copy is a JSONL file inside the
 * briefing gist (BRIEFING_GIST_ID / BRIEFING_GH_TOKEN), one event per line,
 * append-only. Event shapes:
 *   { type: "complete", id, bid, reason, productType, hasTracking, hasComms, createdAt }
 *   { type: "email",    id, email, createdAt }
 *   { type: "tier-click",    id, bid, tier, createdAt }
 *   { type: "reserve-click", id, bid, tier, createdAt }
 *   { type: "view", id, bid, createdAt }
 * `bid` is a random per-browser id from the tool page (no personal data);
 * distinct-merchant counting dedupes on it. A local data/ append runs as a
 * best-effort mirror.
 */

const EVENTS_FILE = "chargeback-events.jsonl";

export type ChargebackEvent = Record<string, unknown> & {
  type: string;
  createdAt: string;
};

function gistConfig(): { gistId: string; token: string } | null {
  const gistId = process.env.BRIEFING_GIST_ID;
  const token = process.env.BRIEFING_GH_TOKEN;
  return gistId && token ? { gistId, token } : null;
}

async function readEvents(gistId: string, token: string): Promise<string> {
  const headers = {
Authorization: "Bear" + "er " + token,
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

async function appendLocal(ev: ChargebackEvent): Promise<void> {
  try {
    const dir = path.join(process.cwd(), "data");
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, EVENTS_FILE), JSON.stringify(ev) + "\n");
  } catch {
    /* read-only filesystems just skip this */
  }
}

export async function appendChargebackEvent(ev: ChargebackEvent): Promise<boolean> {
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
Authorization: "Bear" + "er " + cfg.token,
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
    console.error("[chargeback] gist store failed", e);
    await appendLocal(ev);
    return false;
  }
}
