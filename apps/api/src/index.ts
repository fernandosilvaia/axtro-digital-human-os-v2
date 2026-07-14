import {
  AuthenticationError,
  assertAuthorizedTenantMatch,
  createDevelopmentIdentityVerifier,
  resolveAuthorizedRequestContext,
  withAuthorizedTenantTransaction,
  type AuthorizedRequestContext,
  type AuthorizedTenantTransaction,
  type DevelopmentIdentityRegistration,
  type IdentityVerifier,
  type RequestAuthenticationInput,
  type TenantTransactionRunner,
} from "@axtro/auth";
import type { RuntimeConfig } from "@axtro/config";
import type { TenantId } from "@axtro/domain";

export interface ApiAuthenticationMiddlewareOptions {
  readonly identityVerifier: IdentityVerifier;
  readonly transactionRunner: TenantTransactionRunner;
}

export interface DevelopmentApiAuthenticationMiddlewareOptions {
  readonly config: Pick<RuntimeConfig, "environment" | "dev_auth_enabled">;
  readonly registrations: readonly DevelopmentIdentityRegistration[];
  readonly transactionRunner: TenantTransactionRunner;
}

export interface ApiAuthenticationMiddleware {
  authenticate(headers: unknown): AuthorizedRequestContext;
  runWithTenantTransaction<Result>(
    headers: unknown,
    work: (input: AuthorizedTenantTransaction) => Promise<Result>,
  ): Promise<Result>;
}

/**
 * Framework-neutral header extraction. It accepts only plain header records,
 * treats duplicate case-insensitive headers as invalid, and returns no raw
 * header object to application handlers.
 */
export function extractApiAuthenticationInput(headers: unknown): RequestAuthenticationInput {
  try {
    const record = headerRecord(headers);
    return Object.freeze({
      authorization: requiredSingleHeader(record, "authorization"),
      requestedTenantId: requiredSingleHeader(record, "x-tenant-id"),
    });
  } catch {
    throw new AuthenticationError();
  }
}

export function createApiAuthenticationMiddleware(
  options: ApiAuthenticationMiddlewareOptions,
): ApiAuthenticationMiddleware {
  return Object.freeze({
    authenticate(headers: unknown): AuthorizedRequestContext {
      return resolveAuthorizedRequestContext(
        extractApiAuthenticationInput(headers),
        options.identityVerifier,
      );
    },
    async runWithTenantTransaction<Result>(
      headers: unknown,
      work: (input: AuthorizedTenantTransaction) => Promise<Result>,
    ): Promise<Result> {
      const request = resolveAuthorizedRequestContext(
        extractApiAuthenticationInput(headers),
        options.identityVerifier,
      );
      return withAuthorizedTenantTransaction(request, options.transactionRunner, work);
    },
  });
}

/** M0 development-only constructor. It cannot instantiate a production verifier. */
export function createDevelopmentApiAuthenticationMiddleware(
  options: DevelopmentApiAuthenticationMiddlewareOptions,
): ApiAuthenticationMiddleware {
  return createApiAuthenticationMiddleware({
    identityVerifier: createDevelopmentIdentityVerifier(options.config, options.registrations),
    transactionRunner: options.transactionRunner,
  });
}

/** M1 routes must call this before accepting a tenant ID from path or body. */
export function assertApiResourceTenant(request: AuthorizedRequestContext, tenantId: unknown): TenantId {
  return assertAuthorizedTenantMatch(request, tenantId);
}

function headerRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid headers");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("invalid headers");
  return value as Record<string, unknown>;
}

function requiredSingleHeader(headers: Record<string, unknown>, expectedName: string): unknown {
  const descriptors = Object.entries(Object.getOwnPropertyDescriptors(headers));
  const matching = descriptors.filter(([name]) => name.toLowerCase() === expectedName);
  if (matching.length !== 1) throw new Error("invalid headers");
  const descriptor = matching[0]![1];
  if (!("value" in descriptor)) throw new Error("invalid headers");
  return descriptor.value;
}
