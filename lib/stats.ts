import "server-only";
import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/**
 * Lightweight, privacy-friendly funnel counters.
 * Only aggregate counts are kept: no IPs, cookies, user agents or per-visitor IDs.
 *
 * Storage: in-memory, mirrored to /tmp/stats.json so a warm serverless instance
 * survives restarts. On Vercel each instance has its own /tmp, so numbers are
 * per-instance and best-effort (they reset on cold starts / redeploys).
 */

export const EVENT_TYPES = ["pageview", "scan_run", "checkout_click"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const MAX_REFS = 200;
const MAX_DAYS = 90;
const DIRECT = "(direct)";

type Counts = Record<EventType, number>;

export interface Stats {
  since: string;
  updatedAt: string;
  totals: Counts;
  byRef: Record<string, Counts>;
  byDay: Record<string, Counts>;
  checkoutByPlan: Record<string, number>;
}

const STATS_FILE = path.join(process.env.STATS_DIR ?? os.tmpdir(), "stats.json");

const zero = (): Counts => ({ pageview: 0, scan_run: 0, checkout_click: 0 });

function empty(): Stats {
  const now = new Date().toISOString();
  return { since: now, updatedAt: now, totals: zero(), byRef: {}, byDay: {}, checkoutByPlan: {} };
}

let stats: Stats | null = null;
let loading: Promise<Stats> | null = null;
let writing: Promise<void> = Promise.resolve();

async function load(): Promise<Stats> {
  if (stats) return stats;
  loading ??= (async () => {
    try {
      const parsed = JSON.parse(await readFile(STATS_FILE, "utf8")) as Partial<Stats>;
      stats = { ...empty(), ...parsed, totals: { ...zero(), ...parsed.totals } };
    } catch {
      stats = empty();
    }
    return stats;
  })();
  return loading;
}

/**
 * Write the current snapshot. Awaited by the request (serverless instances may be
 * frozen right after responding, so no deferred timers). Writes are serialised and
 * atomic (tmp file + rename); failures (e.g. read-only FS) are logged and ignored.
 */
function persist(): Promise<void> {
  const snapshot = JSON.stringify(stats);
  writing = writing
    .then(async () => {
      const tmp = `${STATS_FILE}.${process.pid}.tmp`;
      await writeFile(tmp, snapshot);
      await rename(tmp, STATS_FILE);
    })
    .catch((e) => console.error("[stats] persist failed", e));
  return writing;
}

/** Normalise a ?ref= value into a short, safe label. */
export function cleanRef(ref: unknown): string {
  if (typeof ref !== "string") return DIRECT;
  const v = ref.trim().toLowerCase().replace(/[^a-z0-9._\-]/g, "").slice(0, 40);
  return v || DIRECT;
}

export function isEventType(v: unknown): v is EventType {
  return typeof v === "string" && (EVENT_TYPES as readonly string[]).includes(v);
}

export async function recordEvent(type: EventType, ref: string, plan?: string): Promise<void> {
  const s = await load();
  const day = new Date().toISOString().slice(0, 10);

  s.totals[type]++;

  // Cap distinct refs so junk values can't grow the file unbounded.
  const refKey = s.byRef[ref] || Object.keys(s.byRef).length < MAX_REFS ? ref : "(other)";
  (s.byRef[refKey] ??= zero())[type]++;

  (s.byDay[day] ??= zero())[type]++;
  const days = Object.keys(s.byDay).sort();
  for (const d of days.slice(0, Math.max(0, days.length - MAX_DAYS))) delete s.byDay[d];

  if (type === "checkout_click" && plan) s.checkoutByPlan[plan] = (s.checkoutByPlan[plan] ?? 0) + 1;

  s.updatedAt = new Date().toISOString();
  await persist();
}

export async function getStats(): Promise<Stats> {
  return load();
}
