import { createUuidV7 } from "@axtro/domain";
import { createRecallMeetingBotPort, isRecallRegion, type MeetingBotPort, type RecallRegion } from "@axtro/provider-recall";
import { createTavusVideoConversationPort, type VideoConversationPort } from "@axtro/provider-tavus";

import { constantTimeEquals } from "../security.ts";
import { createServiceRoleClient } from "../supabase/service.ts";
import { logError, logEvent } from "../telemetry.ts";
import { providerTerminationReceiptRef, stableProviderReconciliationReceiptId } from "./index.ts";

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,254}$/;
const RECEIPT_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/-]{7,254}$/;
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{2,79}$/;
const MAX_RECONCILIATION_ATTEMPTS = 8;

type PendingState = "provider_in_flight" | "unknown" | "cleanup_pending";
type ProviderId = "tavus" | "recall";

interface ReconciliationRow {
  readonly reservationId: string;
  readonly providerId: ProviderId;
  readonly providerRef: string | null;
  readonly state: PendingState;
  readonly createdAt: string;
  readonly attempts: number;
  readonly nextAttemptAt: string;
  readonly leaseToken: string;
}

interface ReconciliationBacklog {
  readonly pending: number;
  readonly processing: number;
  readonly deadLetter: number;
  readonly providerInFlight: number;
  readonly unknown: number;
  readonly cleanupPending: number;
  readonly oldestAgeSeconds: number;
  readonly oldestUnknownAgeSeconds: number;
}

interface RpcResult {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
}

interface ReconciliationRpcClient {
  rpc(name: string, parameters?: Readonly<Record<string, unknown>>): PromiseLike<RpcResult>;
}

export interface ProviderEffectReconciliationDependencies {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly createClient?: () => ReconciliationRpcClient;
  readonly createLeaseToken?: () => string;
  readonly createTavusPort?: (apiKey: string) => Pick<VideoConversationPort, "endConversation">;
  readonly createRecallPort?: (apiKey: string, region: RecallRegion) => Pick<MeetingBotPort, "leaveCall">;
  readonly providerTimeoutMs?: number;
  readonly logEvent?: (event: string, context: Readonly<Record<string, unknown>>) => void;
  readonly logError?: (event: string, error: unknown, context: Readonly<Record<string, unknown>>) => void;
}

export interface ProviderEffectReconciliationResult {
  readonly leased: number;
  readonly reconciled: number;
  readonly failed: number;
  readonly deadLettered: number;
  readonly operatorRequired: number;
  readonly backlog: number | null;
  readonly processing: number | null;
  readonly deadLetterBacklog: number | null;
  readonly providerInFlight: number | null;
  readonly unknown: number | null;
  readonly cleanupPending: number | null;
  readonly oldestAgeSeconds: number | null;
  readonly oldestUnknownAgeSeconds: number | null;
}

export type ProviderEffectReconciliationAuthorization = "authorized" | "not_configured" | "unauthorized";

export interface ManualProviderEffectReconciliation {
  readonly reservationId: string;
  readonly receiptId: string;
  readonly evidence: "provider_rejected" | "reconciliation_absent" | "compensation_confirmed";
  readonly providerReceiptRef: string;
}

export function isProviderEffectReconcilerEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.PROVIDER_EFFECT_RECONCILER_ENABLED === "true";
}

export function authorizeProviderEffectReconciliation(
  authorizationHeader: string | null,
  expectedSecret: string | undefined,
): ProviderEffectReconciliationAuthorization {
  const expected = (expectedSecret ?? "").trim();
  if (expected.length < 24) return "not_configured";
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorizationHeader ?? "");
  if (!match || !constantTimeEquals(match[1] ?? "", expected)) return "unauthorized";
  return "authorized";
}

function ownRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : null;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function parseManualProviderEffectReconciliation(value: unknown): ManualProviderEffectReconciliation {
  const record = ownRecord(value);
  if (!record || !hasExactKeys(record, ["reservationId", "receiptId", "evidence", "providerReceiptRef"])) {
    throw new Error("manual reconciliation body must have the exact bounded shape");
  }
  const evidence = record.evidence;
  if (
    typeof record.reservationId !== "string"
    || !UUID_V7_PATTERN.test(record.reservationId)
    || typeof record.receiptId !== "string"
    || !UUID_V7_PATTERN.test(record.receiptId)
    || (evidence !== "provider_rejected" && evidence !== "reconciliation_absent" && evidence !== "compensation_confirmed")
    || typeof record.providerReceiptRef !== "string"
    || !RECEIPT_REF_PATTERN.test(record.providerReceiptRef)
  ) {
    throw new Error("manual reconciliation body is invalid");
  }
  return Object.freeze({
    reservationId: record.reservationId,
    receiptId: record.receiptId,
    evidence,
    providerReceiptRef: record.providerReceiptRef,
  });
}

export async function manuallyReconcileProviderEffect(
  input: ManualProviderEffectReconciliation,
  client?: ReconciliationRpcClient,
): Promise<void> {
  const parsed = parseManualProviderEffectReconciliation(input);
  const supabase = client ?? createServiceRoleClient() as ReconciliationRpcClient;
  const { data, error } = await supabase.rpc("portal_reconcile_provider_effect_service", {
    p_receipt_id: parsed.receiptId,
    p_reservation_id: parsed.reservationId,
    p_evidence: parsed.evidence,
    p_provider_receipt_ref: parsed.providerReceiptRef,
  });
  if (error) throw new Error(`manual provider-effect reconciliation failed: ${error.message}`);
  if (data !== true) throw new Error("manual provider-effect reconciliation receipt was not applied");
}

function parseRow(candidate: unknown, expectedLeaseToken: string): ReconciliationRow {
  const record = ownRecord(candidate);
  if (!record || !hasExactKeys(record, ["reservationId", "providerId", "providerRef", "state", "createdAt", "attempts", "nextAttemptAt", "leaseToken"])) {
    throw new Error("provider-effect lease returned an invalid row shape");
  }
  const createdAt = typeof record.createdAt === "string" ? Date.parse(record.createdAt) : Number.NaN;
  const nextAttemptAt = typeof record.nextAttemptAt === "string" ? Date.parse(record.nextAttemptAt) : Number.NaN;
  if (
    typeof record.reservationId !== "string"
    || !UUID_V7_PATTERN.test(record.reservationId)
    || (record.providerId !== "tavus" && record.providerId !== "recall")
    || (record.providerRef !== null && (typeof record.providerRef !== "string" || !PROVIDER_REF_PATTERN.test(record.providerRef)))
    || (record.state !== "provider_in_flight" && record.state !== "unknown" && record.state !== "cleanup_pending")
    || !Number.isFinite(createdAt)
    || !Number.isFinite(nextAttemptAt)
    || record.leaseToken !== expectedLeaseToken
    || !Number.isInteger(record.attempts)
    || Number(record.attempts) < 1
    || Number(record.attempts) > 1000
  ) {
    throw new Error("provider-effect lease returned an invalid row");
  }
  if (record.state === "cleanup_pending" && record.providerRef === null) {
    throw new Error("cleanup_pending provider effect is missing its provider reference");
  }
  return Object.freeze(record) as unknown as ReconciliationRow;
}

function poisonRowReservationId(candidate: unknown, expectedLeaseToken: string): string | null {
  const record = ownRecord(candidate);
  return record
    && typeof record.reservationId === "string"
    && UUID_V7_PATTERN.test(record.reservationId)
    && record.leaseToken === expectedLeaseToken
    ? record.reservationId
    : null;
}

function parseBacklog(value: unknown): ReconciliationBacklog {
  const record = ownRecord(value);
  const keys = ["pending", "processing", "deadLetter", "providerInFlight", "unknown", "cleanupPending", "oldestAgeSeconds", "oldestUnknownAgeSeconds"] as const;
  if (!record || !hasExactKeys(record, keys) || keys.some((key) => !Number.isInteger(record[key]) || Number(record[key]) < 0)) {
    throw new Error("provider-effect reconciliation backlog returned a malformed payload");
  }
  return record as unknown as ReconciliationBacklog;
}

function retryDelay(attempts: number): number {
  return Math.min(86_400, Math.max(5, 5 * 2 ** Math.min(attempts, 10)));
}

function safeErrorCode(error: unknown, exhausted: boolean): string {
  if (exhausted) return "retry_exhausted";
  const candidate = error instanceof Error && ERROR_CODE_PATTERN.test(error.name.toLowerCase())
    ? error.name.toLowerCase()
    : "provider_cleanup_failed";
  return candidate;
}

async function withTimeout(operation: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`provider cleanup exceeded ${timeoutMs}ms`);
          error.name = "provider_timeout";
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function defaultPorts(env: Readonly<Record<string, string | undefined>>): {
  readonly tavus: Pick<VideoConversationPort, "endConversation">;
  readonly recall: Pick<MeetingBotPort, "leaveCall">;
} {
  const tavusApiKey = (env.TAVUS_API_KEY ?? "").trim();
  const recallApiKey = (env.RECALL_API_KEY ?? "").trim();
  const recallRegion = env.RECALL_API_REGION;
  if (tavusApiKey.length < 8) throw new Error("TAVUS_API_KEY is not configured for provider-effect reconciliation");
  if (recallApiKey.length < 8) throw new Error("RECALL_API_KEY is not configured for provider-effect reconciliation");
  if (!isRecallRegion(recallRegion)) throw new Error("RECALL_API_REGION is invalid for provider-effect reconciliation");
  return {
    tavus: createTavusVideoConversationPort({ apiKey: tavusApiKey, timeoutMs: 20_000 }),
    recall: createRecallMeetingBotPort({ apiKey: recallApiKey, region: recallRegion, timeoutMs: 20_000 }),
  };
}

export async function reconcilePendingProviderEffects(
  limit = 20,
  dependencies: ProviderEffectReconciliationDependencies = {},
): Promise<ProviderEffectReconciliationResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("provider-effect reconciliation limit must be between 1 and 100");
  const env = dependencies.env ?? process.env;
  const suppliedPorts = dependencies.createTavusPort !== undefined && dependencies.createRecallPort !== undefined;
  const ports = suppliedPorts
    ? {
        tavus: dependencies.createTavusPort!((env.TAVUS_API_KEY ?? "").trim()),
        recall: dependencies.createRecallPort!((env.RECALL_API_KEY ?? "").trim(), (env.RECALL_API_REGION ?? "us-east-1") as RecallRegion),
      }
    : defaultPorts(env);
  const supabase = (dependencies.createClient ?? (() => createServiceRoleClient() as ReconciliationRpcClient))();
  const createLeaseToken = dependencies.createLeaseToken ?? createUuidV7;
  const providerTimeoutMs = dependencies.providerTimeoutMs ?? 25_000;
  if (!Number.isInteger(providerTimeoutMs) || providerTimeoutMs < 5 || providerTimeoutMs > 30_000) {
    throw new Error("provider-effect cleanup timeout must be between 5 and 30000ms");
  }
  const emitEvent = dependencies.logEvent ?? logEvent;
  const emitError = dependencies.logError ?? logError;
  let leased = 0;
  let reconciled = 0;
  let failed = 0;
  let deadLettered = 0;
  let operatorRequired = 0;
  const unpersistedFailures: unknown[] = [];

  // Lease and finish one row at a time. A provider call may consume up to 30s;
  // leasing 20 rows under one 60s token made the later rows reclaimable while
  // this worker was still processing them. Sequential single-row leases keep
  // each acknowledgement inside its own lease without a renewal race.
  for (let leaseIndex = 0; leaseIndex < limit; leaseIndex += 1) {
    const leaseToken = createLeaseToken();
    if (!UUID_V7_PATTERN.test(leaseToken)) throw new Error("provider-effect reconciliation lease token must be a UUIDv7");
    const lease = await supabase.rpc("portal_lease_provider_effect_reconciliation_service", {
      p_lease_token: leaseToken,
      p_limit: 1,
      p_lease_seconds: 60,
    });
    if (lease.error) throw new Error(`provider-effect reconciliation lease failed: ${lease.error.message}`);
    if (!Array.isArray(lease.data) || lease.data.length > 1) {
      throw new Error("provider-effect lease returned a malformed payload");
    }
    if (lease.data.length === 0) break;
    leased += 1;
    const candidate = lease.data[0];
    let row: ReconciliationRow;
    try {
      row = parseRow(candidate, leaseToken);
    } catch (validationError) {
      const reservationId = poisonRowReservationId(candidate, leaseToken);
      if (reservationId === null) {
        unpersistedFailures.push(validationError);
        emitError("provider_effect_poison_row_unidentifiable", validationError, {});
        continue;
      }
      const failure = await supabase.rpc("portal_fail_provider_effect_reconciliation_service", {
        p_reservation_id: reservationId,
        p_lease_token: leaseToken,
        p_error_code: "invalid_reconciliation_row",
        p_retry_seconds: 86_400,
        p_permanent: true,
      });
      if (failure.error || failure.data !== true) {
        const persistenceError = new AggregateError(
          [validationError, ...(failure.error ? [new Error(failure.error.message)] : [])],
          "provider-effect poison row could not be dead-lettered",
        );
        unpersistedFailures.push(persistenceError);
        emitError("provider_effect_poison_row_persistence_failed", persistenceError, {});
      } else {
        deadLettered += 1;
        emitError("provider_effect_poison_row_dead_lettered", validationError, {});
      }
      continue;
    }

    if (row.state !== "cleanup_pending" || row.providerRef === null) {
      operatorRequired += 1;
      const exhausted = row.attempts >= MAX_RECONCILIATION_ATTEMPTS;
      const failure = await supabase.rpc("portal_fail_provider_effect_reconciliation_service", {
        p_reservation_id: row.reservationId,
        p_lease_token: leaseToken,
        p_error_code: exhausted ? "operator_evidence_required" : "provider_outcome_unknown",
        p_retry_seconds: retryDelay(row.attempts),
        p_permanent: exhausted,
      });
      if (failure.error || failure.data !== true) {
        const persistenceError = new Error(failure.error
          ? `provider-effect operator barrier persistence failed: ${failure.error.message}`
          : "provider-effect operator barrier was not applied");
        unpersistedFailures.push(persistenceError);
        emitError("provider_effect_operator_barrier_persistence_failed", persistenceError, {});
      } else if (exhausted) {
        deadLettered += 1;
        emitError("provider_effect_operator_evidence_dead_lettered", new Error("operator evidence required"), {
          provider: row.providerId,
          state: row.state,
          attempts: row.attempts,
        });
      } else {
        failed += 1;
        emitError("provider_effect_operator_evidence_required", new Error("provider outcome remains unknown"), {
          provider: row.providerId,
          state: row.state,
          attempts: row.attempts,
        });
      }
      continue;
    }

    try {
      const billingVoid = await supabase.rpc("portal_void_unleased_billing_usage_service", {
        p_reservation_id: row.reservationId,
        p_reason: "cleanup_reconciliation",
      });
      if (billingVoid.error || billingVoid.data !== true) {
        const voidError = new Error(billingVoid.error
          ? `provider-effect billing void failed: ${billingVoid.error.message}`
          : "provider-effect billing usage is leased or could not be voided");
        voidError.name = "billing_void_unavailable";
        throw voidError;
      }
      if (row.providerId === "tavus") await withTimeout(ports.tavus.endConversation(row.providerRef), providerTimeoutMs);
      else await withTimeout(ports.recall.leaveCall(row.providerRef), providerTimeoutMs);
      const providerReceiptRef = providerTerminationReceiptRef(row.providerId, row.providerRef);
      const receiptId = stableProviderReconciliationReceiptId(row.reservationId, "compensation_confirmed", providerReceiptRef);
      const acknowledgement = await supabase.rpc("portal_ack_provider_effect_reconciliation_service", {
        p_reservation_id: row.reservationId,
        p_lease_token: leaseToken,
        p_receipt_id: receiptId,
        p_evidence: "compensation_confirmed",
        p_provider_receipt_ref: providerReceiptRef,
      });
      if (acknowledgement.error) throw new Error(`provider-effect reconciliation ack failed: ${acknowledgement.error.message}`);
      if (acknowledgement.data !== true) throw new Error("provider-effect reconciliation ack was not applied");
      reconciled += 1;
    } catch (cleanupError) {
      const exhausted = row.attempts >= MAX_RECONCILIATION_ATTEMPTS;
      const failure = await supabase.rpc("portal_fail_provider_effect_reconciliation_service", {
        p_reservation_id: row.reservationId,
        p_lease_token: leaseToken,
        p_error_code: safeErrorCode(cleanupError, exhausted),
        p_retry_seconds: retryDelay(row.attempts),
        p_permanent: exhausted,
      });
      if (failure.error || failure.data !== true) {
        const persistenceError = new AggregateError(
          [cleanupError, ...(failure.error ? [new Error(failure.error.message)] : [])],
          failure.error ? "provider-effect cleanup failure persistence failed" : "provider-effect cleanup failure was not applied",
        );
        unpersistedFailures.push(persistenceError);
        emitError("provider_effect_cleanup_failure_persistence_failed", persistenceError, {});
      } else if (exhausted) {
        deadLettered += 1;
        emitError("provider_effect_cleanup_dead_lettered", cleanupError, {
          provider: row.providerId,
          state: row.state,
          attempts: row.attempts,
        });
      } else failed += 1;
    }
  }

  let backlog: ReconciliationBacklog | null = null;
  try {
    const snapshot = await supabase.rpc("portal_provider_effect_reconciliation_backlog_service");
    if (snapshot.error) throw new Error(`provider-effect reconciliation backlog failed: ${snapshot.error.message}`);
    backlog = parseBacklog(snapshot.data);
  } catch (backlogError) {
    emitError("provider_effect_reconciliation_backlog_observation_failed", backlogError, {});
  }

  const result = Object.freeze({
    leased,
    reconciled,
    failed,
    deadLettered,
    operatorRequired,
    backlog: backlog?.pending ?? null,
    processing: backlog?.processing ?? null,
    deadLetterBacklog: backlog?.deadLetter ?? null,
    providerInFlight: backlog?.providerInFlight ?? null,
    unknown: backlog?.unknown ?? null,
    cleanupPending: backlog?.cleanupPending ?? null,
    oldestAgeSeconds: backlog?.oldestAgeSeconds ?? null,
    oldestUnknownAgeSeconds: backlog?.oldestUnknownAgeSeconds ?? null,
  });
  emitEvent("provider_effect_reconciliation_completed", result);
  if (unpersistedFailures.length > 0) {
    throw new AggregateError(unpersistedFailures, "provider-effect reconciliation batch has unpersisted row failures");
  }
  return result;
}
