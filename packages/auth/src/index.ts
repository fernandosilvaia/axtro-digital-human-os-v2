import type { RuntimeConfig } from "@axtro/config";
import {
  assertTenantMatch,
  createTenantContext,
  parseActorType,
  parseTenantId,
  type ActorId,
  type ActorType,
  type TenantContext,
  type TenantId,
} from "@axtro/domain";
import { createRemoteJWKSet, jwtVerify } from "jose";

export type IdentityKind = "user" | "service";

export interface TenantGrantInput {
  readonly tenantId: string;
  readonly grantedScopes: readonly string[];
  readonly purposes: readonly string[];
}

export interface VerifiedIdentityInput {
  readonly actorId: string;
  readonly actorType: ActorType;
  readonly identityKind: IdentityKind;
  readonly tenantGrants: readonly TenantGrantInput[];
}

export interface DevelopmentIdentityRegistration extends VerifiedIdentityInput {
  /** Opaque local lookup key, not a production credential or JWT. */
  readonly token: string;
}

export interface VerifiedTenantGrant {
  readonly tenantId: TenantId;
  readonly grantedScopes: readonly string[];
  readonly purposes: readonly string[];
}

export interface VerifiedIdentity {
  readonly actorId: ActorId;
  readonly actorType: ActorType;
  readonly identityKind: IdentityKind;
  readonly tenantGrants: readonly VerifiedTenantGrant[];
}

export interface IdentityVerifier {
  /** Verifies a bearer token before any tenant selection or database operation. */
  verifyBearerToken(token: string): unknown;
}

export interface RequestAuthenticationInput {
  readonly authorization: unknown;
  readonly requestedTenantId: unknown;
}

export interface AuthorizedRequestContext {
  readonly tenantContext: TenantContext;
  readonly principal: Readonly<{
    actorId: ActorId;
    actorType: ActorType;
    identityKind: IdentityKind;
  }>;
}

export interface TenantTransaction {
  execute(statement: string, values: readonly unknown[]): Promise<void>;
}

/** The adapter owns BEGIN, COMMIT and ROLLBACK around the callback. */
export interface TenantTransactionRunner {
  withinTransaction<Result>(work: (transaction: TenantTransaction) => Promise<Result>): Promise<Result>;
}

export interface AuthorizedTenantTransaction {
  readonly tenantContext: TenantContext;
  readonly transaction: TenantTransaction;
}

export class AuthenticationError extends Error {
  readonly status = 401 as const;
  readonly code = "authentication_failed" as const;

  constructor() {
    super("Request authentication failed");
    this.name = "AuthenticationError";
  }
}

export class TenantAuthorizationError extends Error {
  readonly status = 403 as const;
  readonly code = "tenant_not_authorized" as const;

  constructor() {
    super("Requested tenant is not authorized");
    this.name = "TenantAuthorizationError";
  }
}

export class DevelopmentAuthConfigurationError extends Error {
  constructor() {
    super("Development authentication is unavailable for this runtime");
    this.name = "DevelopmentAuthConfigurationError";
  }
}

export class TenantTransactionContextError extends Error {
  constructor() {
    super("Tenant transaction context could not be established");
    this.name = "TenantTransactionContextError";
  }
}

/** Long enough for a real signed session JWT (three base64url segments), not just short opaque dev tokens. */
const BEARER_PATTERN = /^Bearer ([A-Za-z0-9._~-]{8,4096})$/;
const DEVELOPMENT_TOKEN_PATTERN = /^dev_[a-z0-9][a-z0-9._-]{7,127}$/;
const IDENTITY_KINDS = ["user", "service"] as const;
const SUPPORTED_GRANTED_SCOPES = [
  "session:read",
  "session:write",
  "provider:use",
  "tool:use",
  "event:relay",
  "event:observe",
  "workflow:dispatch",
  "workflow:execute",
  "workflow:observe",
] as const;
const WORKFLOW_SERVICE_SCOPES = [
  "event:relay",
  "event:observe",
  "workflow:dispatch",
  "workflow:execute",
  "workflow:observe",
] as const;
const M0_PURPOSES = ["essential_processing", "provider_auth", "tool_auth"] as const;
const AUTHORIZED_REQUESTS = new WeakSet<object>();

/** SQL is parameterized and the `true` flag gives `set_config` SET LOCAL semantics. */
export const SET_LOCAL_TENANT_CONTEXT_SQL = "SELECT set_config('app.tenant_id', $1, true)";

/**
 * Create a normalized identity only after a verifier has checked its issuer.
 * This function is intentionally strict so a future OIDC adapter cannot pass
 * arbitrary claim shapes into tenant selection.
 */
export function createVerifiedIdentity(input: unknown): VerifiedIdentity {
  try {
    return normalizeVerifiedIdentity(input);
  } catch {
    throw new AuthenticationError();
  }
}

/**
 * Deterministic M0 verifier. It is explicitly disabled outside development and
 * test, and maps an opaque bearer value to server-provided registrations only.
 */
export class DeterministicDevelopmentIdentityVerifier implements IdentityVerifier {
  readonly #identities: ReadonlyMap<string, VerifiedIdentity>;

  constructor(
    configuration: Pick<RuntimeConfig, "environment" | "dev_auth_enabled">,
    registrations: readonly DevelopmentIdentityRegistration[],
  ) {
    if (!permitsDevelopmentAuth(configuration)) throw new DevelopmentAuthConfigurationError();
    const identities = new Map<string, VerifiedIdentity>();
    try {
      for (const registration of normalizedArray(registrations)) {
        const record = plainRecord(registration);
        assertExactKeys(record, ["token", "actorId", "actorType", "identityKind", "tenantGrants"]);
        const token = parseDevelopmentToken(readData(record, "token"));
        if (identities.has(token)) throw new NormalizationError();
        identities.set(token, normalizeVerifiedIdentity({
          actorId: readData(record, "actorId"),
          actorType: readData(record, "actorType"),
          identityKind: readData(record, "identityKind"),
          tenantGrants: readData(record, "tenantGrants"),
        }));
      }
    } catch {
      throw new DevelopmentAuthConfigurationError();
    }
    if (identities.size === 0) throw new DevelopmentAuthConfigurationError();
    this.#identities = identities;
  }

  verifyBearerToken(token: string): VerifiedIdentity {
    let normalizedToken: string;
    try {
      normalizedToken = parseDevelopmentToken(token);
    } catch {
      throw new AuthenticationError();
    }
    const identity = this.#identities.get(normalizedToken);
    if (identity === undefined) throw new AuthenticationError();
    return identity;
  }
}

export function createDevelopmentIdentityVerifier(
  configuration: Pick<RuntimeConfig, "environment" | "dev_auth_enabled">,
  registrations: readonly DevelopmentIdentityRegistration[],
): DeterministicDevelopmentIdentityVerifier {
  return new DeterministicDevelopmentIdentityVerifier(configuration, registrations);
}

/**
 * Resolve a verified bearer and requested tenant into the only context services
 * may consume. In M0 the selector maps to `X-Tenant-Id`, which API design
 * reserves for service identities. User tenant selection needs a later,
 * claim-based public contract and must not be inferred from a header.
 */
export function resolveAuthorizedRequestContext(
  input: RequestAuthenticationInput,
  verifier: IdentityVerifier,
): AuthorizedRequestContext {
  const authorization = readAuthenticationInput(input, "authorization");
  const requestedTenantValue = readAuthenticationInput(input, "requestedTenantId");
  const bearer = parseBearerAuthorization(authorization);
  const identity = verifyIdentity(verifier, bearer);
  if (identity.identityKind !== "service") throw new TenantAuthorizationError();
  let requestedTenantId: TenantId;
  try {
    requestedTenantId = parseTenantId(requestedTenantValue);
  } catch {
    throw new AuthenticationError();
  }
  const grant = identity.tenantGrants.find((candidate) => candidate.tenantId === requestedTenantId);
  if (grant === undefined) throw new TenantAuthorizationError();

  const tenantContext = createTenantContext({
    tenantId: grant.tenantId,
    actorId: identity.actorId,
    actorType: identity.actorType,
    grantedScopes: grant.grantedScopes,
    purposes: grant.purposes,
  });
  const resolved = Object.freeze({
    tenantContext,
    principal: Object.freeze({
      actorId: identity.actorId,
      actorType: identity.actorType,
      identityKind: identity.identityKind,
    }),
  });
  AUTHORIZED_REQUESTS.add(resolved);
  return resolved;
}

/** Reject path or body resource identifiers that do not match the authenticated tenant. */
export function assertAuthorizedTenantMatch(request: AuthorizedRequestContext, tenantId: unknown): TenantId {
  return assertTenantMatch(requireAuthorizedRequest(request).tenantContext, asTenantString(tenantId));
}

/** Return tenant context only after the request object passes the authenticated-context guard. */
export function getAuthorizedTenantContext(request: AuthorizedRequestContext): TenantContext {
  return requireAuthorizedRequest(request).tenantContext;
}

/**
 * Apply tenant context inside the runner-owned transaction before a handler can
 * access a repository. No session-level PostgreSQL setting is emitted.
 */
export async function withAuthorizedTenantTransaction<Result>(
  request: AuthorizedRequestContext,
  runner: TenantTransactionRunner,
  work: (input: AuthorizedTenantTransaction) => Promise<Result>,
): Promise<Result> {
  const authorized = requireAuthorizedRequest(request);
  const transactionRunner = requireTransactionRunner(runner);
  if (typeof work !== "function") throw new TenantTransactionContextError();

  return transactionRunner.withinTransaction(async (transaction) => {
    const activeTransaction = requireTransaction(transaction);
    try {
      await activeTransaction.execute(
        SET_LOCAL_TENANT_CONTEXT_SQL,
        Object.freeze([authorized.tenantContext.tenantId]),
      );
    } catch {
      throw new TenantTransactionContextError();
    }
    return work(Object.freeze({ tenantContext: authorized.tenantContext, transaction: activeTransaction }));
  });
}

export interface AsyncIdentityVerifier {
  /** Verifies a bearer token before any tenant selection or database operation. */
  verifyBearerToken(token: string): Promise<unknown>;
}

export interface UserRequestAuthenticationInput {
  readonly authorization: unknown;
}

export interface SupabaseSessionVerifierConfiguration {
  readonly supabaseUrl: string;
}

export class SupabaseSessionConfigurationError extends Error {
  constructor() {
    super("Supabase project URL is invalid");
    this.name = "SupabaseSessionConfigurationError";
  }
}

const SUPABASE_TENANT_ROLE_SCOPES: Readonly<Record<string, readonly string[]>> = {
  tenant_admin: Object.freeze(["session:read", "session:write", "provider:use", "tool:use"]),
  tenant_operator: Object.freeze(["session:read"]),
};

/**
 * Verifies Supabase-issued session JWTs against the project's own JWKS
 * endpoint, so this service never holds a shared signing secret.
 * `tenant_id` and `actor_id` come only from the `app_metadata` claims a
 * database-side Auth Hook injects at token-mint time from
 * `user_tenant_memberships`; a token without them authenticates no tenant.
 */
export class SupabaseSessionIdentityVerifier implements AsyncIdentityVerifier {
  readonly #jwks: ReturnType<typeof createRemoteJWKSet>;
  readonly #issuer: string;

  constructor(configuration: SupabaseSessionVerifierConfiguration) {
    const projectUrl = parseSupabaseProjectUrl(configuration.supabaseUrl);
    this.#jwks = createRemoteJWKSet(new URL(`${projectUrl}/auth/v1/.well-known/jwks.json`));
    this.#issuer = `${projectUrl}/auth/v1`;
  }

  async verifyBearerToken(token: string): Promise<unknown> {
    const { payload } = await jwtVerify(token, this.#jwks, {
      issuer: this.#issuer,
      audience: "authenticated",
    });
    const appMetadata = plainRecord(payload["app_metadata"]);
    const tenantId = requiredString(readData(appMetadata, "tenant_id"));
    const actorId = requiredString(readData(appMetadata, "actor_id"));
    const tenantRole = requiredString(readData(appMetadata, "tenant_role"));
    const scopes = SUPABASE_TENANT_ROLE_SCOPES[tenantRole];
    if (scopes === undefined) throw new NormalizationError();

    return {
      actorId,
      actorType: "human_operator",
      identityKind: "user",
      tenantGrants: [{ tenantId, grantedScopes: scopes, purposes: ["essential_processing"] }],
    };
  }
}

/**
 * The user-session counterpart to `resolveAuthorizedRequestContext`. Tenant
 * selection here is never a header the caller supplies: it is only the
 * single tenant claim a verified session JWT already carries.
 */
export async function resolveAuthorizedUserRequestContext(
  input: UserRequestAuthenticationInput,
  verifier: AsyncIdentityVerifier,
): Promise<AuthorizedRequestContext> {
  let authorization: unknown;
  try {
    authorization = readData(plainRecord(input), "authorization");
  } catch {
    throw new AuthenticationError();
  }
  const bearer = parseBearerAuthorization(authorization);
  const identity = await verifyIdentityAsync(verifier, bearer);
  if (identity.identityKind !== "user") throw new TenantAuthorizationError();
  if (identity.tenantGrants.length !== 1) throw new TenantAuthorizationError();
  const grant = identity.tenantGrants[0]!;

  const tenantContext = createTenantContext({
    tenantId: grant.tenantId,
    actorId: identity.actorId,
    actorType: identity.actorType,
    grantedScopes: grant.grantedScopes,
    purposes: grant.purposes,
  });
  const resolved = Object.freeze({
    tenantContext,
    principal: Object.freeze({
      actorId: identity.actorId,
      actorType: identity.actorType,
      identityKind: identity.identityKind,
    }),
  });
  AUTHORIZED_REQUESTS.add(resolved);
  return resolved;
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Production Supabase URLs are always https; loopback http is accepted only for tests. */
function parseSupabaseProjectUrl(value: string): string {
  if (typeof value !== "string") throw new SupabaseSessionConfigurationError();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SupabaseSessionConfigurationError();
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new SupabaseSessionConfigurationError();
  }
  const isLoopbackHttp = url.protocol === "http:" && LOOPBACK_HOSTNAMES.has(url.hostname);
  if (url.protocol !== "https:" && !isLoopbackHttp) throw new SupabaseSessionConfigurationError();
  return value.replace(/\/+$/, "");
}

async function verifyIdentityAsync(verifier: AsyncIdentityVerifier, token: string): Promise<VerifiedIdentity> {
  try {
    if (verifier === null || typeof verifier !== "object" || typeof verifier.verifyBearerToken !== "function") {
      throw new NormalizationError();
    }
    return normalizeVerifiedIdentity(await verifier.verifyBearerToken(token));
  } catch {
    throw new AuthenticationError();
  }
}

function normalizeVerifiedIdentity(input: unknown): VerifiedIdentity {
  const record = plainRecord(input);
  assertExactKeys(record, ["actorId", "actorType", "identityKind", "tenantGrants"]);
  const actorId = requiredString(readData(record, "actorId"));
  const actorType = parseActorType(readData(record, "actorType"));
  const identityKind = parseIdentityKind(readData(record, "identityKind"));
  const rawGrants = normalizedArray(readData(record, "tenantGrants"));
  if (rawGrants.length === 0) throw new NormalizationError();

  const tenantIds = new Set<TenantId>();
  const grants: VerifiedTenantGrant[] = [];
  let normalizedActorId: ActorId | undefined;
  for (const rawGrant of rawGrants) {
    const grantRecord = plainRecord(rawGrant);
    assertExactKeys(grantRecord, ["tenantId", "grantedScopes", "purposes"]);
    const context = createTenantContext({
      tenantId: requiredString(readData(grantRecord, "tenantId")),
      actorId,
      actorType,
      grantedScopes: normalizedLabels(readData(grantRecord, "grantedScopes"), SUPPORTED_GRANTED_SCOPES),
      purposes: normalizedLabels(readData(grantRecord, "purposes"), M0_PURPOSES),
    });
    if (
      context.grantedScopes.some((scope) => WORKFLOW_SERVICE_SCOPES.includes(scope as (typeof WORKFLOW_SERVICE_SCOPES)[number]))
      && (identityKind !== "service" || actorType !== "workflow")
    ) throw new NormalizationError();
    if (tenantIds.has(context.tenantId)) throw new NormalizationError();
    tenantIds.add(context.tenantId);
    normalizedActorId ??= context.actorId;
    grants.push(Object.freeze({
      tenantId: context.tenantId,
      grantedScopes: context.grantedScopes,
      purposes: context.purposes,
    }));
  }
  if (normalizedActorId === undefined) throw new NormalizationError();
  return Object.freeze({
    actorId: normalizedActorId,
    actorType,
    identityKind,
    tenantGrants: Object.freeze(grants),
  });
}

function permitsDevelopmentAuth(configuration: unknown): boolean {
  try {
    const record = plainRecord(configuration);
    const environment = readData(record, "environment");
    const enabled = readData(record, "dev_auth_enabled");
    return enabled === true && (environment === "development" || environment === "test");
  } catch {
    return false;
  }
}

function parseBearerAuthorization(value: unknown): string {
  if (typeof value !== "string") throw new AuthenticationError();
  const match = BEARER_PATTERN.exec(value);
  if (match === null) throw new AuthenticationError();
  return match[1]!;
}

function verifyIdentity(verifier: IdentityVerifier, token: string): VerifiedIdentity {
  try {
    if (verifier === null || typeof verifier !== "object" || typeof verifier.verifyBearerToken !== "function") {
      throw new NormalizationError();
    }
    return normalizeVerifiedIdentity(verifier.verifyBearerToken(token));
  } catch {
    throw new AuthenticationError();
  }
}

function readAuthenticationInput(input: RequestAuthenticationInput, key: "authorization" | "requestedTenantId"): unknown {
  try {
    return readData(plainRecord(input), key);
  } catch {
    throw new AuthenticationError();
  }
}

function requireAuthorizedRequest(value: AuthorizedRequestContext): AuthorizedRequestContext {
  if (value === null || typeof value !== "object" || !AUTHORIZED_REQUESTS.has(value)) {
    throw new TenantAuthorizationError();
  }
  return value;
}

function requireTransactionRunner(value: TenantTransactionRunner): TenantTransactionRunner {
  try {
    if (value === null || typeof value !== "object" || typeof value.withinTransaction !== "function") {
      throw new NormalizationError();
    }
    return value;
  } catch {
    throw new TenantTransactionContextError();
  }
}

function requireTransaction(value: TenantTransaction): TenantTransaction {
  try {
    if (value === null || typeof value !== "object" || typeof value.execute !== "function") {
      throw new NormalizationError();
    }
    return value;
  } catch {
    throw new TenantTransactionContextError();
  }
}

function asTenantString(value: unknown): string {
  if (typeof value !== "string") throw new TenantAuthorizationError();
  return value;
}

function parseDevelopmentToken(value: unknown): string {
  if (typeof value !== "string" || !DEVELOPMENT_TOKEN_PATTERN.test(value)) throw new NormalizationError();
  return value;
}

function parseIdentityKind(value: unknown): IdentityKind {
  if (typeof value !== "string" || !(IDENTITY_KINDS as readonly string[]).includes(value)) {
    throw new NormalizationError();
  }
  return value as IdentityKind;
}

function normalizedLabels(value: unknown, allowed: readonly string[]): readonly string[] {
  const labels = normalizedArray(value);
  if (labels.length === 0) throw new NormalizationError();
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const label of labels) {
    if (typeof label !== "string" || !allowed.includes(label) || seen.has(label)) {
      throw new NormalizationError();
    }
    seen.add(label);
    normalized.push(label);
  }
  return Object.freeze(normalized);
}

function normalizedArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new NormalizationError();
  const normalized: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) throw new NormalizationError();
    normalized.push(descriptor.value);
  }
  return Object.freeze(normalized);
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new NormalizationError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new NormalizationError();
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Object.keys(record);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new NormalizationError();
  }
}

function readData(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) throw new NormalizationError();
  return descriptor.value;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") throw new NormalizationError();
  return value;
}

class NormalizationError extends Error {}
