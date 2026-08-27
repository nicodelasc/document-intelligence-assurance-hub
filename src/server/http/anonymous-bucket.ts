import { createHash, randomBytes } from "node:crypto";

export const ANONYMOUS_BUCKET_COOKIE = "diah_browser";

export type AnonymousBucket = {
  protectedBucket: string;
  setCookie: string | null;
};

function cookieValue(request: Request): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name !== ANONYMOUS_BUCKET_COOKIE) continue;
    const value = valueParts.join("=");
    return /^[A-Za-z0-9_-]{32,128}$/.test(value) ? value : null;
  }
  return null;
}

export function defaultBucketTokenSource(): string {
  return randomBytes(32).toString("base64url");
}

export function resolveAnonymousBucket(
  request: Request,
  input: { tokenSource: () => string; secure: boolean },
): AnonymousBucket {
  const existing = cookieValue(request);
  const rawToken = existing ?? input.tokenSource();
  const protectedBucket = `sha256:${createHash("sha256").update(rawToken).digest("hex")}`;
  const attributes = [
    `${ANONYMOUS_BUCKET_COOKIE}=${rawToken}`,
    "Path=/",
    "Max-Age=86400",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (input.secure) attributes.push("Secure");
  return {
    protectedBucket,
    setCookie: existing ? null : attributes.join("; "),
  };
}

export function attachBucketCookie(response: Response, bucket: AnonymousBucket): Response {
  if (bucket.setCookie) response.headers.append("set-cookie", bucket.setCookie);
  return response;
}
