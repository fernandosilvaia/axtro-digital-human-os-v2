import { isRateLimited } from "../rate-limit.ts";

export const PUBLIC_DEMO_MAX_IN_FLIGHT = 32;

export const PUBLIC_DEMO_RATE_LIMITS = Object.freeze({
  start: Object.freeze({ windowMs: 60_000, maxRequests: 120 }),
  read: Object.freeze({ windowMs: 60_000, maxRequests: 900 }),
  command: Object.freeze({ windowMs: 60_000, maxRequests: 600 }),
} as const);

export type PublicDemoCapacityOperation = keyof typeof PUBLIC_DEMO_RATE_LIMITS;

export type PublicDemoCapacityLease = Readonly<{
  release: () => void;
}>;

let inFlight = 0;

/**
 * Best-effort per-instance load shedding for an anonymous, zero-authority
 * surface. Keys are fixed by code, never derived from forwarded client data.
 * A platform ingress limit remains a production rollout requirement.
 */
export function acquirePublicDemoCapacity(
  operation: PublicDemoCapacityOperation,
): PublicDemoCapacityLease | null {
  const limit = PUBLIC_DEMO_RATE_LIMITS[operation];
  if (isRateLimited(`public-demo:${operation}`, limit.windowMs, limit.maxRequests)) return null;
  if (inFlight >= PUBLIC_DEMO_MAX_IN_FLIGHT) return null;

  inFlight += 1;
  let released = false;
  return Object.freeze({
    release() {
      if (released) return;
      released = true;
      inFlight = Math.max(0, inFlight - 1);
    },
  });
}
