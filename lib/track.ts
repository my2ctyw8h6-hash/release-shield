export type TrackEvent = "pageview" | "scan_run" | "checkout_click";

const REF_KEY = "rs_ref";

/** External referrer host ("google.com", "chatgpt.com"), or undefined for same-site/none. */
function referrerHost(): string | undefined {
  try {
    if (!document.referrer) return undefined;
    const host = new URL(document.referrer).hostname.replace(/^www\./, "");
    return host && host !== window.location.hostname.replace(/^www\./, "") ? host : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Attribution for this tab session: ?ref=, else ?utm_source= (ChatGPT adds utm_source=chatgpt.com),
 * else the external referrer host so organic search and link clicks don't all land in "(direct)".
 * The first value seen is remembered so later events (scan, checkout) keep it.
 */
export function currentRef(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const q = new URLSearchParams(window.location.search);
    const explicit = q.get("ref") || q.get("utm_source");
    if (explicit) {
      sessionStorage.setItem(REF_KEY, explicit);
      return explicit;
    }
    const stored = sessionStorage.getItem(REF_KEY);
    if (stored) return stored;
    const host = referrerHost();
    if (host) sessionStorage.setItem(REF_KEY, host);
    return host;
  } catch {
    return undefined;
  }
}

/** Fire-and-forget analytics event. Never throws, never blocks the UI. */
export function track(type: TrackEvent, extra?: { plan?: string }): void {
  try {
    const body = JSON.stringify({ type, ref: currentRef(), path: window.location.pathname, ...extra });
    // sendBeacon survives page navigation (e.g. redirect to Stripe checkout).
    if (typeof navigator !== "undefined" && navigator.sendBeacon?.("/api/track", new Blob([body], { type: "text/plain" }))) return;
    fetch("/api/track", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    /* ignore */
  }
}
