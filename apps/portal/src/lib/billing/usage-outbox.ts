import { createUuidV7, isUuidV7 } from "@axtro/domain";
import {
  createStripeBillingPort,
  StripeBillingError,
  type ReportOverageUsageRequest,
  type StripeBillingCatalogReceipt,
  type VerifyStripeBillingCatalogRequest,
} from "@axtro/provider-stripe";

import { PLAN_CATALOG, PLAN_ORDER } from "./plans.ts";
import { constantTimeEquals } from "../security.ts";
import { createServiceRoleClient } from "../supabase/service.ts";
import { logError, logEvent } from "../telemetry.ts";

const MAX_DELIVERY_ATTEMPTS = 8;
const BILLING_USAGE_LEASE_SECONDS = 60;
const STRIPE_CUSTOMER_PATTERN = /^cus_[A-Za-z0-9]{1,255}$/;

interface UsageRow {
  readonly id: string;
  readonly stripeCustomerId: string;
  readonly eventName: string;
  readonly quantity: number;
  readonly idempotencyKey: string;
  readonly billingPeriodStart: string;
  readonly billingPeriodEnd: string | null;
  readonly meterEventAt: string;
  readonly attempts: number;
}

interface BacklogSnapshot {
  readonly pending: number;
  readonly oldestAgeSeconds: number;
  readonly deadLetter: number;
  readonly held: number;
  readonly oldestHeldAgeSeconds: number;
  readonly providerInFlight: number;
  readonly unknown: number;
  readonly cleanupPending: number;
  readonly oldestProviderPendingAgeSeconds: number;
}

interface RpcResult {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
}

interface BillingRpcClient {
  rpc(name: string, parameters?: Readonly<Record<string, unknown>>): PromiseLike<RpcResult>;
}

interface BillingUsagePort {
  reportOverageUsage(request: ReportOverageUsageRequest): Promise<void>;
  verifyBillingCatalog(request: VerifyStripeBillingCatalogRequest): Promise<StripeBillingCatalogReceipt>;
}

export interface BillingDispatchDependencies {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly createClient?: () => BillingRpcClient;
  readonly createPort?: (apiKey: string) => BillingUsagePort;
  readonly createLeaseToken?: () => string;
  readonly logEvent?: (event: string, context: Readonly<Record<string, unknown>>) => void;
  readonly logError?: (event: string, error: unknown, context: Readonly<Record<string, unknown>>) => void;
}

export interface UsageDispatchResult {
  readonly catalogVerified: true;
  readonly leased: number;
  readonly delivered: number;
  readonly failed: number;
  readonly deadLettered: number;
  readonly backlog: number | null;
  readonly oldestAgeSeconds: number | null;
  readonly deadLetterBacklog: number | null;
  readonly held: number | null;
  readonly oldestHeldAgeSeconds: number | null;
  readonly providerInFlight: number | null;
  readonly unknown: number | null;
  readonly cleanupPending: number | null;
  readonly oldestProviderPendingAgeSeconds: number | null;
}

function billingCatalogExpectation(
  env: Readonly<Record<string, string | undefined>>,
  apiKey: string,
): VerifyStripeBillingCatalogRequest {
  const livemode = apiKey.startsWith("sk_live_")
    ? true
    : apiKey.startsWith("sk_test_")
      ? false
      : null;
  if (livemode === null) throw new Error("STRIPE_SECRET_KEY must identify test or live mode");
  const eventName = (env.STRIPE_CONVERSATION_OVERAGE_EVENT_NAME ?? "").trim();
  if (eventName.length === 0) throw new Error("STRIPE_CONVERSATION_OVERAGE_EVENT_NAME is not configured");
  return {
    eventName,
    livemode,
    prices: PLAN_ORDER.flatMap((planId) => {
      const plan = PLAN_CATALOG[planId];
      return [
        {
          priceId: (env[plan.basePriceEnvVar] ?? "").trim(),
          unitAmountUsdCents: plan.priceUsdCents,
          usageType: "licensed" as const,
        },
        {
          priceId: (env[plan.overagePriceEnvVar] ?? "").trim(),
          unitAmountUsdCents: plan.overageUsdCentsPerConversation,
          usageType: "metered" as const,
        },
      ];
    }),
  };
}

export type BillingDispatchAuthorization = "authorized" | "not_configured" | "unauthorized";

/** The protected worker is inert unless the durable outbox is explicitly enabled. */
export function isBillingUsageDispatchEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return (env.BILLING_USAGE_OUTBOX_ENABLED ?? "").trim().toLowerCase() === "true";
}

/** Pure authorization seam used by the route and its negative unit tests. */
export function authorizeBillingDispatch(
  authorizationHeader: string | null,
  expectedSecret: string | undefined,
): BillingDispatchAuthorization {
  const expected = (expectedSecret ?? "").trim();
  if (expected.length < 24) return "not_configured";
  const match = /^(?:Bearer)\s+([^\s]+)$/i.exec(authorizationHeader ?? "");
  if (!match || !constantTimeEquals(match[1] ?? "", expected)) return "unauthorized";
  return "authorized";
}

function retryDelay(attempts: number): number {
  return Math.min(86_400, Math.max(5, 5 * 2 ** Math.min(attempts, 10)));
}

function isPermanent(error: unknown, attempts: number): boolean {
  if (attempts >= MAX_DELIVERY_ATTEMPTS) return true;
  if (!(error instanceof StripeBillingError)) return false;
  if (error.code === "invalid_request") return true;
  if (error.code !== "provider_rejected" || error.httpStatus === null) return false;
  // Request timeout/conflict/rate-limit responses are ambiguous or explicitly
  // retryable. Every retry keeps the durable Stripe idempotency key.
  if ([408, 409, 425, 429].includes(error.httpStatus)) return false;
  return error.httpStatus >= 400 && error.httpStatus < 500;
}

function dispatchRetryDelay(error: unknown, attempts: number): number {
  if (error instanceof StripeBillingError && error.retryAfterSeconds !== null) {
    return Math.min(86_400, Math.max(5, error.retryAfterSeconds));
  }
  return retryDelay(attempts);
}

function errorCode(error: unknown, permanent: boolean): string {
  if (permanent && !(error instanceof StripeBillingError)) return "retry_exhausted";
  return error instanceof StripeBillingError ? error.code : "dispatcher_error";
}

function parseUsageRow(candidate: unknown): UsageRow {
  const row = candidate as Partial<UsageRow> | null;
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("billing usage lease returned an invalid row");
  }
  const periodStart = typeof row.billingPeriodStart === "string" ? Date.parse(row.billingPeriodStart) : Number.NaN;
  const periodEnd = typeof row.billingPeriodEnd === "string" ? Date.parse(row.billingPeriodEnd) : null;
  const meterEventAt = typeof row.meterEventAt === "string" ? Date.parse(row.meterEventAt) : Number.NaN;
  if (
    !isUuidV7(row.id)
    || typeof row.stripeCustomerId !== "string"
    || !STRIPE_CUSTOMER_PATTERN.test(row.stripeCustomerId)
    || typeof row.eventName !== "string"
    || row.eventName.length < 1
    || row.eventName.length > 100
    || !Number.isInteger(row.quantity)
    || (row.quantity ?? 0) < 1
    || (row.quantity ?? 0) > 100_000
    || typeof row.idempotencyKey !== "string"
    || row.idempotencyKey.length < 1
    || row.idempotencyKey.length > 200
    || typeof row.billingPeriodStart !== "string"
    || !Number.isFinite(periodStart)
    || (row.billingPeriodEnd !== null && typeof row.billingPeriodEnd !== "string")
    || (periodEnd !== null && !Number.isFinite(periodEnd))
    || (periodEnd !== null && periodEnd <= periodStart)
    || typeof row.meterEventAt !== "string"
    || !Number.isFinite(meterEventAt)
    || meterEventAt < periodStart
    || (periodEnd !== null && meterEventAt >= periodEnd)
    || !Number.isInteger(row.attempts)
    || (row.attempts ?? 0) < 1
  ) {
    throw new Error("billing usage lease returned an invalid row");
  }
  return row as UsageRow;
}

function poisonRowIdentity(candidate: unknown): { readonly id: string; readonly attempts: number } | null {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const row = candidate as { readonly id?: unknown; readonly attempts?: unknown };
  if (!isUuidV7(row.id)) return null;
  const attempts = Number.isInteger(row.attempts) && (row.attempts as number) > 0 ? row.attempts as number : 1;
  return { id: row.id, attempts };
}

function parseBacklog(data: unknown): BacklogSnapshot {
  const snapshot = data as Partial<BacklogSnapshot> | null;
  if (
    snapshot === null
    || typeof snapshot !== "object"
    || !Number.isInteger(snapshot.pending)
    || !Number.isInteger(snapshot.oldestAgeSeconds)
    || !Number.isInteger(snapshot.deadLetter)
    || !Number.isInteger(snapshot.held)
    || !Number.isInteger(snapshot.oldestHeldAgeSeconds)
    || !Number.isInteger(snapshot.providerInFlight)
    || !Number.isInteger(snapshot.unknown)
    || !Number.isInteger(snapshot.cleanupPending)
    || !Number.isInteger(snapshot.oldestProviderPendingAgeSeconds)
    || Object.values(snapshot).some((value) => typeof value === "number" && value < 0)
  ) {
    throw new Error("billing usage backlog returned a malformed payload");
  }
  return snapshot as BacklogSnapshot;
}

export async function dispatchBillingUsageOutbox(
  limit = 20,
  dependencies: BillingDispatchDependencies = {},
): Promise<UsageDispatchResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("billing usage limit must be between 1 and 100");

  const env = dependencies.env ?? process.env;
  const apiKey = (env.STRIPE_SECRET_KEY ?? "").trim();
  if (apiKey.length === 0) throw new Error("STRIPE_SECRET_KEY is not configured");

  // Validate provider configuration before taking a database lease. A bad
  // key must not make healthy rows wait for lease expiry.
  const port = (dependencies.createPort ?? ((key) => createStripeBillingPort({ apiKey: key })))(apiKey);
  const expectedCatalog = billingCatalogExpectation(env, apiKey);
  const catalogReceipt = await port.verifyBillingCatalog(expectedCatalog);
  if (
    catalogReceipt.verified !== true
    || catalogReceipt.eventName !== expectedCatalog.eventName
    || catalogReceipt.livemode !== expectedCatalog.livemode
    || catalogReceipt.priceCount !== expectedCatalog.prices.length
  ) {
    throw new Error("Stripe billing catalog preflight did not return an exact receipt");
  }
  const supabase = (dependencies.createClient ?? (() => createServiceRoleClient() as BillingRpcClient))();
  const createLeaseToken = dependencies.createLeaseToken ?? createUuidV7;
  const emitEvent = dependencies.logEvent ?? logEvent;
  const emitError = dependencies.logError ?? logError;
  const leaseTokens = new Set<string>();
  let leased = 0;
  let delivered = 0;
  let failed = 0;
  let deadLettered = 0;
  const isolatedErrors: unknown[] = [];

  // Stripe permits a legal request to consume the adapter's full 20-second
  // timeout. Leasing a whole batch for 60 seconds would therefore let later
  // rows expire while earlier rows are still being dispatched. Claim exactly
  // one row with a fresh fencing token immediately before its provider call.
  for (let index = 0; index < limit; index += 1) {
    const leaseToken = createLeaseToken();
    if (!isUuidV7(leaseToken)) throw new Error("billing usage lease token must be a UUIDv7");
    if (leaseTokens.has(leaseToken)) throw new Error("billing usage lease token must be unique per row");
    leaseTokens.add(leaseToken);

    const { data, error } = await supabase.rpc("portal_lease_billing_usage_service", {
      p_lease_token: leaseToken,
      p_limit: 1,
      p_lease_seconds: BILLING_USAGE_LEASE_SECONDS,
    });
    if (error) throw new Error(`billing usage lease failed: ${error.message}`);
    if (!Array.isArray(data) || data.length > 1) {
      throw new Error("billing usage lease returned a malformed payload");
    }
    if (data.length === 0) break;
    leased += 1;
    const candidate = data[0];
    let row: UsageRow;
    try {
      row = parseUsageRow(candidate);
    } catch (validationError) {
      const identity = poisonRowIdentity(candidate);
      if (identity === null) {
        isolatedErrors.push(validationError);
        emitError("billing_usage_poison_row_unidentifiable", validationError, {});
        continue;
      }
      try {
        const failure = await supabase.rpc("portal_fail_billing_usage_service", {
          p_id: identity.id,
          p_lease_token: leaseToken,
          p_error_code: "invalid_outbox_row",
          p_retry_seconds: retryDelay(identity.attempts),
          p_permanent: true,
        });
        if (failure.error) throw new Error(`billing usage poison-row persistence failed: ${failure.error.message}`);
        if (failure.data !== true) throw new Error("billing usage poison-row failure was not applied");
        deadLettered += 1;
        emitError("billing_usage_poison_row_dead_lettered", validationError, {});
      } catch (persistenceError) {
        isolatedErrors.push(persistenceError);
        emitError("billing_usage_poison_row_persistence_failed", persistenceError, {});
      }
      continue;
    }
    try {
      await port.reportOverageUsage({
        stripeCustomerId: row.stripeCustomerId,
        eventName: row.eventName,
        quantity: row.quantity,
        idempotencyKey: row.idempotencyKey,
        eventTimestamp: row.meterEventAt,
      });
      const acknowledgement = await supabase.rpc("portal_ack_billing_usage_service", {
        p_id: row.id,
        p_lease_token: leaseToken,
      });
      if (acknowledgement.error) throw new Error(`billing usage ack failed: ${acknowledgement.error.message}`);
      if (acknowledgement.data !== true) throw new Error("billing usage ack was not applied");
      delivered += 1;
    } catch (dispatchError) {
      // A missing/ambiguous acknowledgement is retried with the exact same
      // row idempotency key. Stripe can replay the accepted meter event while
      // the database gets another chance to persist the acknowledgement.
      const permanent = isPermanent(dispatchError, row.attempts);
      const failure = await supabase.rpc("portal_fail_billing_usage_service", {
        p_id: row.id,
        p_lease_token: leaseToken,
        p_error_code: errorCode(dispatchError, permanent),
        p_retry_seconds: dispatchRetryDelay(dispatchError, row.attempts),
        p_permanent: permanent,
      });
      if (failure.error || failure.data !== true) {
        const persistenceError = new Error(failure.error
          ? `billing usage failure persistence failed: ${failure.error.message}`
          : "billing usage failure was not applied");
        isolatedErrors.push(persistenceError);
        emitError("billing_usage_failure_persistence_failed", persistenceError, {});
      } else if (permanent) deadLettered += 1;
      else failed += 1;
    }
  }

  let backlog: BacklogSnapshot | null = null;
  try {
    const snapshot = await supabase.rpc("portal_billing_usage_backlog_service");
    if (snapshot.error) throw new Error(`billing usage backlog failed: ${snapshot.error.message}`);
    backlog = parseBacklog(snapshot.data);
  } catch (backlogError) {
    // Delivery receipts are authoritative. A telemetry read failure is
    // observable, but must never turn an already delivered Stripe event into
    // a request-level failure and trigger needless scheduler retries.
    emitError("billing_usage_backlog_observation_failed", backlogError, {});
  }

  const result = Object.freeze({
    catalogVerified: true as const,
    leased,
    delivered,
    failed,
    deadLettered,
    backlog: backlog?.pending ?? null,
    oldestAgeSeconds: backlog?.oldestAgeSeconds ?? null,
    deadLetterBacklog: backlog?.deadLetter ?? null,
    held: backlog?.held ?? null,
    oldestHeldAgeSeconds: backlog?.oldestHeldAgeSeconds ?? null,
    providerInFlight: backlog?.providerInFlight ?? null,
    unknown: backlog?.unknown ?? null,
    cleanupPending: backlog?.cleanupPending ?? null,
    oldestProviderPendingAgeSeconds: backlog?.oldestProviderPendingAgeSeconds ?? null,
  });
  emitEvent("billing_usage_dispatch_completed", result);
  if (isolatedErrors.length > 0) {
    throw new AggregateError(isolatedErrors, "billing usage batch completed with unpersisted row failures");
  }
  return result;
}
