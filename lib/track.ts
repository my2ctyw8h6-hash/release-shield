export type TrackEvent = "pageview" | "scan_run" | "checkout_click";

const REF_KEY = "rs_ref";

/** Read ?ref= from the URL, remembering it for the rest of the tab session so later events are attributed. */
export function currentRef(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("ref");
    if (fromUrl) {
      sessionStorage.setItem(REF_KEY, fromUrl);
      return fromUrl;
    }
    return sessionStorage.getItem(REF_KEY) ?? undefined;
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
