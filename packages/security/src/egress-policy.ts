export interface AdapterEgressRegistration {
  readonly adapterId: string;
  readonly allowedOrigins: readonly string[];
}

/** A capability is issued by composition to one adapter and contains no raw URL. */
export interface AdapterEgressCapability {
  authorize(destination: unknown): AuthorizedOutboundDestination;
  authorizeRedirect(
    previous: AuthorizedOutboundDestination,
    redirectedDestination: unknown,
  ): AuthorizedOutboundDestination;
  dispatch<Result>(
    destination: AuthorizedOutboundDestination,
    transport: (target: AdapterEgressTransportTarget) => Result | Promise<Result>,
  ): Result | Promise<Result>;
}

/** Opaque proof that a destination was approved for one adapter capability. */
export interface AuthorizedOutboundDestination {
  readonly __authorizedOutboundDestination?: never;
}

/** Only capability dispatch resolves this target. Adapters never pass a raw URL to it. */
export interface AdapterEgressTransportTarget {
  readonly href: string;
}

export interface AdapterEgressRegistry {
  capabilityFor(adapterId: unknown): AdapterEgressCapability;
}

export type EgressPolicyErrorCode = "egress_policy_invalid" | "egress_forbidden";

export class EgressPolicyError extends Error {
  readonly code: EgressPolicyErrorCode;
  readonly status = 403 as const;

  constructor(code: EgressPolicyErrorCode) {
    super("Outbound destination was rejected");
    this.name = "EgressPolicyError";
    this.code = code;
  }
}

/**
 * Creates a deny-by-default registry. Only the composition root holds the
 * registry; adapters receive their own capability and must reauthorize every
 * redirect hop before I/O.
 */
export function createAdapterEgressRegistry(registrations: readonly AdapterEgressRegistration[]): AdapterEgressRegistry {
  const allowlists = normalizeRegistrations(registrations);
  return Object.freeze({
    capabilityFor(adapterId: unknown): AdapterEgressCapability {
      const normalizedAdapterId = normalizeAdapterId(adapterId);
      const allowedOrigins = allowlists.get(normalizedAdapterId);
      if (allowedOrigins === undefined) throw new EgressPolicyError("egress_forbidden");
      return createCapability(allowedOrigins);
    },
  });
}

const ADAPTER_ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;
const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

interface NormalizedDestination {
  readonly origin: string;
  readonly href: string;
}

function normalizeRegistrations(registrations: readonly AdapterEgressRegistration[]): ReadonlyMap<string, ReadonlySet<string>> {
  if (!Array.isArray(registrations)) throw new EgressPolicyError("egress_policy_invalid");
  const normalized = new Map<string, ReadonlySet<string>>();
  for (const registration of registrations) {
    const record = exactRecord(registration);
    const adapterId = normalizeAdapterId(readData(record, "adapterId"));
    if (normalized.has(adapterId)) throw new EgressPolicyError("egress_policy_invalid");
    const origins = readData(record, "allowedOrigins");
    if (!Array.isArray(origins)) throw new EgressPolicyError("egress_policy_invalid");
    const allowed = new Set<string>();
    for (const origin of origins) {
      const normalizedOrigin = normalizeAllowedOrigin(origin);
      if (allowed.has(normalizedOrigin)) throw new EgressPolicyError("egress_policy_invalid");
      allowed.add(normalizedOrigin);
    }
    normalized.set(adapterId, allowed);
  }
  return normalized;
}

function createCapability(allowedOrigins: ReadonlySet<string>): AdapterEgressCapability {
  const approvedDestinations = new WeakMap<object, NormalizedDestination>();
  const authorize = (destination: unknown): AuthorizedOutboundDestination => {
    const normalized = normalizeDestination(destination);
    if (!allowedOrigins.has(normalized.origin)) throw new EgressPolicyError("egress_forbidden");
    const proof = Object.freeze({}) as AuthorizedOutboundDestination;
    approvedDestinations.set(proof, normalized);
    return proof;
  };
  return Object.freeze({
    authorize,
    authorizeRedirect(previous: AuthorizedOutboundDestination, redirectedDestination: unknown): AuthorizedOutboundDestination {
      if (previous === null || typeof previous !== "object" || !approvedDestinations.has(previous)) {
        throw new EgressPolicyError("egress_forbidden");
      }
      return authorize(redirectedDestination);
    },
    dispatch<Result>(
      destination: AuthorizedOutboundDestination,
      transport: (target: AdapterEgressTransportTarget) => Result | Promise<Result>,
    ): Result | Promise<Result> {
      if (destination === null || typeof destination !== "object") throw new EgressPolicyError("egress_forbidden");
      const approved = approvedDestinations.get(destination);
      if (approved === undefined || typeof transport !== "function") throw new EgressPolicyError("egress_forbidden");
      return transport(Object.freeze({ href: approved.href }));
    },
  });
}

function normalizeAllowedOrigin(value: unknown): string {
  const destination = parseHttpsUrl(value);
  if (destination.pathname !== "/" || destination.search !== "" || destination.hash !== "") {
    throw new EgressPolicyError("egress_policy_invalid");
  }
  return destination.origin;
}

function normalizeDestination(value: unknown): NormalizedDestination {
  const destination = parseHttpsUrl(value);
  return Object.freeze({ origin: destination.origin, href: destination.href });
}

function parseHttpsUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    throw new EgressPolicyError("egress_forbidden");
  }
  let destination: URL;
  try {
    destination = new URL(value);
  } catch {
    throw new EgressPolicyError("egress_forbidden");
  }
  if (
    destination.protocol !== "https:"
    || destination.username !== ""
    || destination.password !== ""
    || destination.hash !== ""
    || destination.port !== ""
    || !isPublicHostname(destination.hostname)
  ) {
    throw new EgressPolicyError("egress_forbidden");
  }
  return destination;
}

function isPublicHostname(value: string): boolean {
  const hostname = value.toLowerCase();
  if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || hostname.includes(":")
    || isIpv4Literal(hostname)
  ) {
    return false;
  }
  return HOSTNAME_PATTERN.test(hostname);
}

function isIpv4Literal(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^[0-9]{1,3}$/.test(part))) return false;
  return parts.every((part) => Number(part) >= 0 && Number(part) <= 255);
}

function normalizeAdapterId(value: unknown): string {
  if (typeof value !== "string" || !ADAPTER_ID_PATTERN.test(value)) throw new EgressPolicyError("egress_policy_invalid");
  return value;
}

function exactRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new EgressPolicyError("egress_policy_invalid");
  let prototype: object | null;
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length > 0) throw new Error("symbols are not supported");
  } catch {
    throw new EgressPolicyError("egress_policy_invalid");
  }
  if (prototype !== Object.prototype && prototype !== null) throw new EgressPolicyError("egress_policy_invalid");
  const keys = Object.keys(descriptors);
  if (keys.length !== 2 || keys.some((key) => key !== "adapterId" && key !== "allowedOrigins")) {
    throw new EgressPolicyError("egress_policy_invalid");
  }
  for (const key of ["adapterId", "allowedOrigins"]) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) throw new EgressPolicyError("egress_policy_invalid");
  }
  return value as Record<string, unknown>;
}

function readData(record: Record<string, unknown>, key: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key);
  } catch {
    throw new EgressPolicyError("egress_policy_invalid");
  }
  if (descriptor === undefined || !("value" in descriptor)) throw new EgressPolicyError("egress_policy_invalid");
  return descriptor.value;
}
