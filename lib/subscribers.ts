import "server-only";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Email subscribers for report-change alerts and the leak digest.
 *
 * Durable store: a `subscribers.jsonl` file in the same private GitHub Gist
 * the briefing feed uses (BRIEFING_GIST_ID / BRIEFING_GH_TOKEN), one JSON
 * object per line, append-only. A local data/subscribers.jsonl append runs
 * as a best-effort mirror, mirroring the /api/lead route's fallback.
 */

const SUBSCRIBERS_FILE = "subscribers.jsonl";

export interface Subscriber {
  email: string;
  source: string;
  createdAt: string;
}

type AddResult = "added" | "duplicate" | "failed";

function gistConfig(): { gistId: string; token: string } | null {
  const gistId = process.env.BRIEFING_GIST_ID;
  const token = process.env.BRIEFING_GH_TOKEN;
  return gistId && token ? { gistId, token } : null;
}

async function readSubscribers(gistId: string, token: string): Promise<string> {
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
  const file = data?.files?.[SUBSCRIBERS_FILE];
  if (!file) return "";
  let content: string = file.content ?? "";
  if (file.truncated && file.raw_url) {
    const raw = await fetch(file.raw_url, { headers, cache: "no-store" });
    if (!raw.ok) throw new Error(`gist raw ${raw.status}`);
    content = await raw.text();
  }
  return content;
}

async function appendLocal(sub: Subscriber): Promise<void> {
  try {
    const dir = path.join(process.cwd(), "data");
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, SUBSCRIBERS_FILE), JSON.stringify(sub) + "\n");
  } catch {
    /* read-only filesystems just skip this */
  }
}

export async function addSubscriber(email: string, source: string): Promise<AddResult> {
  const sub: Subscriber = { email, source, createdAt: new Date().toISOString() };
  const cfg = gistConfig();
  if (!cfg) {
    await appendLocal(sub);
    return "failed";
  }
  try {
    const existing = await readSubscribers(cfg.gistId, cfg.token);
    const dupe = existing.split("\n").some((line) => {
      try {
        return (JSON.parse(line) as Subscriber).email === email;
      } catch {
        return false;
      }
    });
    if (dupe) return "duplicate";
    const content = existing && !existing.endsWith("\n") ? existing + "\n" : existing;
    const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(cfg.gistId)}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: "application/vnd.github+json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        files: { [SUBSCRIBERS_FILE]: { content: content + JSON.stringify(sub) + "\n" } },
      }),
    });
    if (!res.ok) throw new Error(`gist write ${res.status}`);
    await appendLocal(sub);
    return "added";
  } catch (e) {
    console.error("[subscribe] gist store failed", e);
    await appendLocal(sub);
    return "failed";
  }
}
