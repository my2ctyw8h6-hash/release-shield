import "server-only";
import { createPrivateKey, sign } from "node:crypto";
import { b64url, LICENSE_TTL_SECONDS, TOKEN_PREFIX, type LicensePayload } from "./license";

export function signLicenseToken(payload: LicensePayload): string {
  const raw = process.env.LICENSE_PRIVATE_KEY;
  if (!raw) throw new Error("LICENSE_PRIVATE_KEY is not configured");
  const key = createPrivateKey({ key: Buffer.from(raw, "base64"), format: "der", type: "pkcs8" });
  const now = Math.floor(Date.now() / 1000);
  // The 30-day bound is set at signing: a token is good for 30 days from
  // issuance, and every successful online verify re-issues it fresh.
  const full: LicensePayload = {
    ...payload,
    iat: payload.iat ?? now,
    exp: payload.exp ?? (payload.iat ?? now) + LICENSE_TTL_SECONDS,
  };
  const body = b64url(Buffer.from(JSON.stringify(full)));
  const sig = sign(null, Buffer.from(body), key);
  return `${TOKEN_PREFIX}${body}.${b64url(sig)}`;
}
