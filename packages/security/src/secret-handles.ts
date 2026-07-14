import {
  createTenantContext,
  parseTenantId,
  type TenantContext,
  type TenantId,
} from "@axtro/domain";

declare const secretHandleBrand: unique symbol;

/** Opaque broker reference. It is never a credential value. */
export type SecretHandle = string & { readonly [secretHandleBrand]: "SecretHandle" };
export type SecretPurpose = "provider_auth" | "tool_auth";

export interface SecretHandleReference {
  readonly secretHandle: SecretHandle;
}

export interface SecretLeaseRequest {
  readonly handle: SecretHandle;
  readonly purpose: SecretPurpose;
  readonly providerId: string;
}

/** Metadata-only lease. No method or field materializes a credential value. */
export interface SecretLease {
  readonly leaseId: string;
  readonly tenantId: TenantId;
  readonly handle: SecretHandle;
  readonly purpose: SecretPurpose;
  readonly providerId: string;
  readonly materialized: false;
}

export interface SecretBroker {
  acquireLease(request: SecretLeaseRequest): SecretLease;
}

export interface FakeSecretRegistration {
  readonly tenantId: TenantId;
  readonly handle: SecretHandle;
  readonly providerId: string;
  readonly purposes: readonly SecretPurpose[];
}

export class SecretHandleValidationError extends Error {
  constructor() {
    super("Secret handle is invalid");
    this.name = "SecretHandleValidationError";
  }
}

export class SecretAccessDeniedError extends Error {
  constructor() {
    super("Secret access denied");
    this.name = "SecretAccessDeniedError";
  }
}

const SECRET_HANDLE_PATTERN = /^secret:\/\/[a-z0-9][a-z0-9._/-]{0,480}$/;
const DISALLOWED_HANDLE_CONTENT = /[\s?#=]|(?:sk-|gh[pousr]_|xox[baprs]-|AKIA|-----BEGIN)/i;
const SECRET_PURPOSES = ["provider_auth", "tool_auth"] as const;
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9_-]{0,119}$/;
const PROVIDER_USE_SCOPE = "provider:use";

export function parseSecretHandle(value: unknown): SecretHandle {
  if (typeof value !== "string" || !SECRET_HANDLE_PATTERN.test(value) || DISALLOWED_HANDLE_CONTENT.test(value)) {
    throw new SecretHandleValidationError();
  }
  return value as SecretHandle;
}

export function createSecretHandleReference(value: unknown): SecretHandleReference {
  return Object.freeze({ secretHandle: parseSecretHandle(value) });
}

/**
 * Deterministic local broker used before a real secret manager is selected.
 * It verifies tenancy and purpose but intentionally cannot resolve a value.
 */
export class DeterministicFakeSecretBroker implements SecretBroker {
  readonly #context: TenantContext;
  readonly #registrations: ReadonlyMap<string, Readonly<{
    tenantId: TenantId;
    providerId: string;
    purposes: readonly SecretPurpose[];
    leaseReference: string;
  }>>;

  /**
   * The server constructs one broker for its authenticated tenant context.
   * Callers cannot choose a tenant or consumer when requesting a lease.
   */
  constructor(context: TenantContext, registrations: readonly FakeSecretRegistration[]) {
    this.#context = normalizeTenantContext(context);

    const mapped = new Map<string, Readonly<{
      tenantId: TenantId;
      providerId: string;
      purposes: readonly SecretPurpose[];
      leaseReference: string;
    }>>();
    for (const [index, registration] of registrations.entries()) {
      const handle = parseSecretHandle(registration.handle);
      const tenantId = parseTenantId(registration.tenantId);
      const providerId = parseProviderId(registration.providerId);
      const purposes = normalizePurposes(registration.purposes);
      if (mapped.has(handle)) throw new SecretAccessDeniedError();
      mapped.set(handle, Object.freeze({
        tenantId,
        providerId,
        purposes: Object.freeze(purposes),
        leaseReference: `registration-${index + 1}`,
      }));
    }
    this.#registrations = mapped;
  }

  acquireLease(request: SecretLeaseRequest): SecretLease {
    const handle = parseSecretHandle(request.handle);
    const purpose = parseSecretPurpose(request.purpose);
    const providerId = parseProviderId(request.providerId);
    const tenantId = this.#context.tenantId;
    if (!this.#context.grantedScopes.includes(requiredScopeFor(purpose))) throw new SecretAccessDeniedError();
    if (!this.#context.purposes.includes(purpose)) throw new SecretAccessDeniedError();
    const registration = this.#registrations.get(handle);
    if (
      registration === undefined
      || registration.tenantId !== tenantId
      || registration.providerId !== providerId
      || !registration.purposes.includes(purpose)
    ) {
      throw new SecretAccessDeniedError();
    }
    return Object.freeze({
      leaseId: `fake-lease:${tenantId}:${providerId}:${purpose}:${registration.leaseReference}`,
      tenantId,
      handle,
      purpose,
      providerId,
      materialized: false,
    });
  }
}

function normalizeTenantContext(value: unknown): TenantContext {
  if (value === null || typeof value !== "object") throw new SecretAccessDeniedError();
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.grantedScopes) || !Array.isArray(candidate.purposes)) {
    throw new SecretAccessDeniedError();
  }
  try {
    return createTenantContext({
      tenantId: asString(candidate.tenantId),
      actorId: asString(candidate.actorId),
      actorType: asString(candidate.actorType) as TenantContext["actorType"],
      grantedScopes: candidate.grantedScopes.map(asString),
      purposes: candidate.purposes.map(asString),
    });
  } catch {
    throw new SecretAccessDeniedError();
  }
}

function asString(value: unknown): string {
  if (typeof value !== "string") throw new SecretAccessDeniedError();
  return value;
}

function normalizePurposes(value: readonly SecretPurpose[]): SecretPurpose[] {
  if (!Array.isArray(value) || value.length === 0) throw new SecretAccessDeniedError();
  return value.map((purpose) => parseSecretPurpose(purpose));
}

function parseSecretPurpose(value: unknown): SecretPurpose {
  if (typeof value !== "string" || !(SECRET_PURPOSES as readonly string[]).includes(value)) {
    throw new SecretAccessDeniedError();
  }
  return value as SecretPurpose;
}

function parseProviderId(value: unknown): string {
  if (typeof value !== "string" || !PROVIDER_ID_PATTERN.test(value)) throw new SecretAccessDeniedError();
  return value;
}

function requiredScopeFor(purpose: SecretPurpose): string {
  return purpose === "provider_auth" ? PROVIDER_USE_SCOPE : "tool:use";
}
