import "server-only";
import Stripe from "stripe";
import { PLANS, isPlanId, type PlanId } from "./plans";
import { signLicenseToken } from "./license-server";

/** Bump when Payment Link settings change so stale links aren't reused. */
const LINK_VERSION = "2";

let client: Stripe | null = null;

function getStripe(): Stripe {
  const key = process.env.STRIPE_RESTRICTED_KEY;
  if (!key) throw new Error("STRIPE_RESTRICTED_KEY is not configured");
  if (!/^rk_(live|test)_/.test(key)) throw new Error("STRIPE_RESTRICTED_KEY must be a restricted key (rk_live_ / rk_test_)");
  client ??= new Stripe(key, {
    appInfo: { name: "ReleaseShield", version: "1.0.0" },
    maxNetworkRetries: 2,
    timeout: 15_000,
  });
  return client;
}

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function isPublicUrl(siteUrl: string | null): siteUrl is string {
  if (!siteUrl) return false;
  try {
    const u = new URL(siteUrl);
    return u.protocol === "https:" && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(u.hostname);
  } catch {
    return false;
  }
}

/** One Stripe Product per plan, reused across price changes and kept in sync with the plan name. */
async function findOrCreateProduct(stripe: Stripe, planId: PlanId): Promise<string> {
  const plan = PLANS[planId];
  const name = `ReleaseShield ${plan.name}`;
  let scanned = 0;
  for await (const product of stripe.products.list({ active: true, limit: 100 })) {
    if (product.metadata?.app === "release-shield" && product.metadata?.plan === planId) {
      if (product.name !== name) await stripe.products.update(product.id, { name });
      return product.id;
    }
    if (++scanned >= 500) break;
  }
  const created = await stripe.products.create({ name, metadata: { app: "release-shield", plan: planId } });
  return created.id;
}

async function findOrCreatePrice(stripe: Stripe, planId: PlanId): Promise<Stripe.Price> {
  const plan = PLANS[planId];
  const amount = plan.priceMonthly * 100;
  const existing = await stripe.prices.list({ lookup_keys: [plan.lookupKey], active: true, limit: 1 });
  const found = existing.data[0];
  if (found && found.unit_amount === amount && found.currency === "usd" && found.recurring?.interval === "month") {
    return found;
  }
  // Price changed (or first run): new Price on the plan's product; the lookup key moves to it.
  return stripe.prices.create({
    currency: "usd",
    unit_amount: amount,
    recurring: { interval: "month" },
    lookup_key: plan.lookupKey,
    transfer_lookup_key: Boolean(found),
    product: await findOrCreateProduct(stripe, planId),
    nickname: `${plan.name} $${plan.priceMonthly}/mo`,
    metadata: { app: "release-shield", plan: plan.id },
  });
}

async function findOrCreateLink(planId: PlanId, siteUrl: string | null): Promise<string> {
  const stripe = getStripe();
  const price = await findOrCreatePrice(stripe, planId);
  const redirectBase = isPublicUrl(siteUrl) ? siteUrl.replace(/\/$/, "") : "";

  // Reuse an existing active link for this exact price + redirect target, and collect links that
  // still sell an outdated price for this plan so they can be switched off.
  let scanned = 0;
  let reuse: string | null = null;
  const stale: string[] = [];
  for await (const link of stripe.paymentLinks.list({ active: true, limit: 100 })) {
    if (link.metadata?.app === "release-shield" && link.metadata?.plan === planId && link.metadata?.price_id !== price.id) {
      stale.push(link.id);
    } else if (
      !reuse &&
      link.metadata?.app === "release-shield" &&
      link.metadata?.price_id === price.id &&
      link.metadata?.link_version === LINK_VERSION &&
      (link.metadata?.site_url ?? "") === redirectBase
    ) {
      reuse = link.url;
    }
    if (++scanned >= 500) break;
  }

  // Old price points must stop being purchasable once the plan price changes.
  for (const id of stale) {
    try {
      await stripe.paymentLinks.update(id, { active: false });
      console.info(`[checkout] deactivated outdated payment link ${id} for plan ${planId}`);
    } catch (err) {
      console.error(`[checkout] could not deactivate payment link ${id}`, err instanceof Error ? err.message : err);
    }
  }
  if (reuse) return reuse;

  const link = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    metadata: { app: "release-shield", plan: planId, price_id: price.id, site_url: redirectBase, link_version: LINK_VERSION },
    subscription_data: { metadata: { app: "release-shield", plan: planId } },
    ...(redirectBase
      ? { after_completion: { type: "redirect" as const, redirect: { url: `${redirectBase}/success?plan=${planId}&session_id={CHECKOUT_SESSION_ID}` } } }
      : {}),
  });
  return link.url;
}

/** Returns a real Stripe Payment Link URL for the plan, creating product/price/link on first use. */
export async function getPaymentLinkUrl(planId: PlanId, siteUrl: string | null): Promise<string> {
  const override = process.env[`STRIPE_PAYMENT_LINK_${planId.toUpperCase()}`];
  if (override && /^https:\/\/(buy|checkout)\.stripe\.com\//.test(override)) return override;

  const key = `${planId}|${siteUrl ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = inflight.get(key);
  if (pending) return pending;

  const p = findOrCreateLink(planId, siteUrl)
    .then((url) => {
      cache.set(key, url);
      return url;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function planFromSubscription(sub: Stripe.Subscription): PlanId | undefined {
  if (isPlanId(sub.metadata?.plan)) return sub.metadata.plan;
  for (const item of sub.items.data) {
    const key = item.price.lookup_key;
    const match = Object.values(PLANS).find((p) => p.lookupKey === key || (key && p.legacyLookupKeys?.includes(key)));
    if (match) return match.id;
  }
  return undefined;
}

const ACTIVE = new Set<Stripe.Subscription.Status>(["active", "trialing", "past_due"]);

export type LicenseIssueResult =
  | { ok: true; token: string; plan: PlanId; email?: string }
  | { ok: false; reason: "invalid_session" | "not_paid" | "config" | "stripe_error"; message: string };

/**
 * Turns a completed Checkout Session (from the Payment Link redirect) into a signed license token.
 * Deterministic for a given session, so revisiting the success page re-shows the same token.
 * Requires restricted-key read access to Checkout Sessions and Subscriptions.
 */
export async function issueLicenseForSession(sessionId: string, siteUrl: string): Promise<LicenseIssueResult> {
  if (!/^cs_(live|test)_[A-Za-z0-9]{10,}$/.test(sessionId)) return { ok: false, reason: "invalid_session", message: "Invalid checkout session." };
  if (!process.env.LICENSE_PRIVATE_KEY) return { ok: false, reason: "config", message: "License signing is not configured." };
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.mode !== "subscription" || session.status !== "complete" || !session.subscription) {
      return { ok: false, reason: "not_paid", message: "This checkout hasn't completed yet." };
    }
    const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
    const sub = await stripe.subscriptions.retrieve(subId);
    const plan = planFromSubscription(sub) ?? (isPlanId(session.metadata?.plan) ? session.metadata.plan : undefined);
    if (!plan) return { ok: false, reason: "invalid_session", message: "This subscription isn't a ReleaseShield plan." };
    const email = session.customer_details?.email ?? undefined;
    const token = signLicenseToken({
      v: 1,
      sub: subId,
      cus: typeof session.customer === "string" ? session.customer : session.customer?.id,
      plan,
      email,
      iat: session.created,
      iss: siteUrl.replace(/\/$/, ""),
    });
    return { ok: true, token, plan, email };
  } catch (err) {
    console.error("[license] issue failed", err instanceof Error ? err.message : err);
    return { ok: false, reason: "stripe_error", message: "We couldn't verify this checkout with Stripe." };
  }
}

const statusCache = new Map<string, { at: number; value: { active: boolean; plan?: PlanId; status: string } }>();

/** Live subscription status (cached 10 min per instance). */
export async function getSubscriptionStatus(subId: string): Promise<{ active: boolean; plan?: PlanId; status: string }> {
  const hit = statusCache.get(subId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;
  const sub = await getStripe().subscriptions.retrieve(subId);
  const value = { active: ACTIVE.has(sub.status), plan: planFromSubscription(sub), status: sub.status };
  statusCache.set(subId, { at: Date.now(), value });
  return value;
}
