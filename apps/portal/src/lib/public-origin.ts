const APPROVED_PUBLIC_ORIGINS = new Set([
  "https://closer.axtroai.com",
  "https://portal-production-b43e.up.railway.app",
]);

export const DETERMINISTIC_FAKE_PUBLIC_ORIGIN = "https://portal-production-b43e.up.railway.app";

/**
 * Parses only a root HTTPS origin whose exact host was reviewed for this
 * deployment. Comparing the original value with the parsed origin also
 * rejects explicit default ports and URL-parser normalization tricks.
 */
export function parsePortalPublicOrigin(value: string): string {
  if (value.length === 0 || value !== value.trim()) {
    throw new TypeError("PORTAL_PUBLIC_URL must be an exact approved HTTPS origin");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("PORTAL_PUBLIC_URL must be an exact approved HTTPS origin");
  }

  const canonicalOrigin = parsed.origin;
  const exactRoot = value === canonicalOrigin || value === `${canonicalOrigin}/`;
  if (
    parsed.protocol !== "https:"
    || parsed.username.length !== 0
    || parsed.password.length !== 0
    || parsed.port.length !== 0
    || parsed.pathname !== "/"
    || parsed.search.length !== 0
    || parsed.hash.length !== 0
    || !APPROVED_PUBLIC_ORIGINS.has(canonicalOrigin)
    || !exactRoot
  ) {
    throw new TypeError("PORTAL_PUBLIC_URL must be an exact approved HTTPS origin");
  }

  return canonicalOrigin;
}

/**
 * Real providers require an explicit reviewed origin. Fake mode deliberately
 * ignores ambient URL configuration so local and CI behavior is deterministic.
 */
export function portalPublicOrigin(env: NodeJS.ProcessEnv = process.env): string {
  if ((env.PORTAL_FAKE_PROVIDERS ?? "").trim() === "1") {
    return DETERMINISTIC_FAKE_PUBLIC_ORIGIN;
  }
  return parsePortalPublicOrigin(env.PORTAL_PUBLIC_URL ?? "");
}

export function isPortalPublicOriginConfigured(env: NodeJS.ProcessEnv): boolean {
  try {
    portalPublicOrigin(env);
    return true;
  } catch {
    return false;
  }
}
