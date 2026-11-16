import "server-only";
import { createPrivateKey, sign } from "node:crypto";
import { b64url, TOKEN_PREFIX, type LicensePayload } from "./license";

export function signLicenseToken(payload: LicensePayload): string {
  const raw = process.env.LICENSE_PRIVATE_KEY;
  if (!raw) throw new Error("LICENSE_PRIVATE_KEY is not configured");
  const key = createPrivateKey({ key: Buffer.from(raw, "base64"), format: "der", type: "pkcs8" });
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = sign(null, Buffer.from(body), key);
  return `${TOKEN_PREFIX}${body}.${b64url(sig)}`;
}
