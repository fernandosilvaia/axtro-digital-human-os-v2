import { createHash } from "node:crypto";

import { createUuidV7 } from "@axtro/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import { conversationOverageEventName } from "../billing/plans.ts";
import { createServiceRoleClient } from "../supabase/service.ts";

export type PaidProvider = "tavus" | "recall";
export type PaidEffectState = "reserved" | "provider_in_flight" | "committed" | "released" | "unknown" | "cleanup_pending" | "completed";
export type BeginOutcome = "reserved" | "replayed" | "capped" | "blocked_unknown";

export interface ProviderEffectReservation {
  readonly outcome: BeginOutcome;
  readonly reservationId: string | null;
  readonly state: PaidEffectState | null;
  readonly providerRef: string | null;
  readonly providerUrl: string | null;
  readonly billableOverage: boolean;
  readonly retryGeneration: number;
  readonly customerDeliveryState: "held" | "activated" | "voided" | null;
  readonly maxDurationSeconds: number | null;
  readonly estimatedCostUsd: string | null;
}

export interface BeginProviderEffectInput {
  readonly tenantId: string;
  readonly agentId: string;
  readonly idempotencyKey: string;
  readonly provider: PaidProvider;
  readonly relatedRef?: string | null;
  /** Server-owned hard maximum used by Tavus; Recall must omit it. */
  readonly maxDurationSeconds?: number | null;
}

export interface CompensateCommittedProviderEffectInput {
  readonly reservationId: string;
  readonly provider: PaidProvider;
  readonly providerRef: string;
  readonly failureCode: string;
  /** The request path owns exactly one termination attempt for this call. */
  readonly terminate: () => Promise<void>;
}

export interface CompensateCommittedProviderEffectDependencies {
  readonly markCleanupPending?: typeof markCleanupPending;
  readonly voidUnleasedBillingUsage?: typeof voidUnleasedBillingUsage;
  readonly reconcileProviderEffect?: typeof reconcileProviderEffect;
}

const COMMAND_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,254}$/;

function effectTuple(provider: PaidProvider): { effectKind: string; capBucket: string } {
  return provider === "tavus"
    ? { effectKind: "tavus_conversation", capBucket: "tavus_video_daily" }
    : { effectKind: "recall_bot", capBucket: "recall_bot_active" };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function stableEffectKey(parts: readonly (string | null | undefined)[]): string {
  const material = parts.map((part) => part ?? "-").join("\u001f");
  return `effect:${createHash("sha256").update(material).digest("hex").slice(0, 40)}`;
}

export function isPaidEffectCommandId(value: unknown): value is string {
  return typeof value === "string" && COMMAND_ID_PATTERN.test(value);
}

/**
 * A command ID identifies one human/control-plane intention. It is generated
 * once at that boundary and must be reused by every transport retry. Content
 * such as agent/link/mode is deliberately not the identity: a second click or
 * a recurring meeting is a new intention even when all content is identical.
 */
export function paidEffectIntentKey(commandId: string, discriminator: string): string {
  if (!isPaidEffectCommandId(commandId)) throw new Error("paid effect commandId must be a UUID");
  if (discriminator.trim().length === 0) throw new Error("paid effect discriminator is required");
  return stableEffectKey([commandId.toLowerCase(), discriminator]);
}

/** Bounded provider-facing label that always retains the full 128-bit correlation token. */
export function providerCorrelationLabel(prefix: string, reservationId: string, maxChars: number): string {
  if (!UUID_V7_PATTERN.test(reservationId)) throw new Error("provider reservationId must be a UUIDv7");
  if (!Number.isInteger(maxChars) || maxChars < reservationId.length + 2 || maxChars > 255) {
    throw new Error("provider label maximum is invalid");
  }
  const normalized = prefix.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) throw new Error("provider label prefix is required");
  const prefixBudget = maxChars - reservationId.length - 1;
  return `${normalized.slice(0, prefixBudget)}-${reservationId}`;
}

export async function beginProviderEffect(input: BeginProviderEffectInput, client?: SupabaseClient): Promise<ProviderEffectReservation> {
  const supabase = client ?? createServiceRoleClient();
  const tuple = effectTuple(input.provider);
  const { data, error } = await supabase.rpc("portal_begin_provider_effect_service", {
    p_reservation_id: createUuidV7(),
    p_cost_event_id: createUuidV7(),
    p_tenant_id: input.tenantId,
    p_agent_id: input.agentId,
    p_idempotency_key: input.idempotencyKey,
    p_provider_id: input.provider,
    p_effect_kind: tuple.effectKind,
    p_cap_bucket: tuple.capBucket,
    p_related_ref: input.relatedRef ?? null,
    p_meter_event_name: conversationOverageEventName(),
    p_max_duration_seconds: input.provider === "tavus" ? input.maxDurationSeconds ?? null : null,
  });
  if (error) throw new Error(`provider effect reservation failed: ${error.message}`);
  const row = asRecord(data);
  const outcome = row.outcome;
  if (outcome !== "reserved" && outcome !== "replayed" && outcome !== "capped" && outcome !== "blocked_unknown") {
    throw new Error("provider effect reservation returned an invalid outcome");
  }
  return Object.freeze({
    outcome,
    reservationId: typeof row.reservationId === "string" ? row.reservationId : null,
    state: typeof row.state === "string" ? row.state as PaidEffectState : null,
    providerRef: typeof row.providerRef === "string" ? row.providerRef : null,
    providerUrl: typeof row.providerUrl === "string" ? row.providerUrl : null,
    billableOverage: row.billableOverage === true,
    retryGeneration: Number.isInteger(row.retryGeneration) && Number(row.retryGeneration) >= 0 ? Number(row.retryGeneration) : 0,
    customerDeliveryState: row.customerDeliveryState === "held" || row.customerDeliveryState === "activated" || row.customerDeliveryState === "voided"
      ? row.customerDeliveryState
      : null,
    maxDurationSeconds: Number.isInteger(row.maxDurationSeconds) ? Number(row.maxDurationSeconds) : null,
    estimatedCostUsd: typeof row.estimatedCostUsd === "string" || typeof row.estimatedCostUsd === "number"
      ? String(row.estimatedCostUsd)
      : null,
  });
}

export async function retryReleasedProviderEffect(
  input: BeginProviderEffectInput,
  reservation: ProviderEffectReservation,
  client?: SupabaseClient,
): Promise<ProviderEffectReservation> {
  if (reservation.state !== "released") return reservation;
  if (reservation.retryGeneration < 1) throw new Error("released paid effect is missing a retry generation");
  const retryKey = `${input.idempotencyKey}:retry:${reservation.retryGeneration}`;
  if (retryKey.length > 200) throw new Error("paid effect retry idempotency key exceeds 200 characters");
  return beginProviderEffect({ ...input, idempotencyKey: retryKey }, client);
}

export async function acquireProviderDispatch(reservationId: string, client?: SupabaseClient): Promise<boolean> {
  const supabase = client ?? createServiceRoleClient();
  const { data, error } = await supabase.rpc("portal_mark_provider_effect_in_flight_service", { p_reservation_id: reservationId });
  if (error) throw new Error(`provider dispatch fence failed: ${error.message}`);
  return asRecord(data).acquired === true;
}

export async function commitProviderEffect(reservationId: string, providerRef: string, providerUrl?: string | null, relatedRef?: string | null, client?: SupabaseClient): Promise<void> {
  const supabase = client ?? createServiceRoleClient();
  const { data, error } = await supabase.rpc("portal_commit_provider_effect_service", {
    p_reservation_id: reservationId,
    p_provider_ref: providerRef,
    p_provider_url: providerUrl ?? null,
    p_related_ref: relatedRef ?? null,
  });
  if (error || asRecord(data).committed !== true) throw new Error(`provider effect commit failed: ${error?.message ?? "not committed"}`);
}

/**
 * A provider reference is already financial evidence. If its atomic commit
 * fails, retain it behind the cleanup barrier; request-path code must not infer
 * from an old JS reservation snapshot that it is safe to release capacity.
 */
export async function commitKnownProviderEffect(
  reservationId: string,
  providerRef: string,
  providerUrl?: string | null,
  relatedRef?: string | null,
  client?: SupabaseClient,
): Promise<void> {
  try {
    await commitProviderEffect(reservationId, providerRef, providerUrl, relatedRef, client);
  } catch (commitError) {
    try {
      await markCleanupPending(reservationId, providerRef, "provider_created_commit_failed", client);
    } catch (cleanupError) {
      throw new AggregateError(
        [commitError, cleanupError],
        `provider effect commit and cleanup fence failed for provider ref ${providerRef}`,
      );
    }
    throw commitError;
  }
}

/**
 * Owns the dangerous create-succeeded/commit-failed interval. Once a provider
 * ref exists the caller must attempt termination exactly once, irrespective
 * of whether the database cleanup fence itself is temporarily unavailable.
 */
export async function commitProviderEffectOrCompensate(
  reservationId: string,
  provider: PaidProvider,
  providerRef: string,
  terminate: () => Promise<void>,
  providerUrl?: string | null,
  relatedRef?: string | null,
  client?: SupabaseClient,
): Promise<void> {
  try {
    await commitProviderEffect(reservationId, providerRef, providerUrl, relatedRef, client);
    return;
  } catch (commitError) {
    const failures: unknown[] = [commitError];
    try {
      await markCleanupPending(reservationId, providerRef, "provider_created_commit_failed", client);
    } catch (fenceError) {
      failures.push(fenceError);
    }

    try {
      await terminate();
    } catch (terminationError) {
      failures.push(terminationError);
      throw new AggregateError(failures, `provider ${provider} commit failed and known ref cleanup is pending`);
    }

    const providerReceiptRef = providerTerminationReceiptRef(provider, providerRef);
    const receiptId = stableProviderReconciliationReceiptId(reservationId, "compensation_confirmed", providerReceiptRef);
    try {
      await reconcileProviderEffect(receiptId, reservationId, "compensation_confirmed", providerReceiptRef, client);
    } catch (reconciliationError) {
      failures.push(reconciliationError);
      throw new AggregateError(failures, `provider ${provider} was terminated but reconciliation persistence failed`);
    }
    throw new AggregateError(failures, `provider ${provider} commit failed; known ref was terminated and reconciled`);
  }
}

export async function markProviderEffectUnknown(reservationId: string, failureCode: string, client?: SupabaseClient): Promise<void> {
  const supabase = client ?? createServiceRoleClient();
  const { data, error } = await supabase.rpc("portal_mark_provider_effect_unknown_service", { p_reservation_id: reservationId, p_failure_code: failureCode });
  if (error || data !== true) throw new Error(`provider unknown barrier failed: ${error?.message ?? "transition not applied"}`);
}

export async function releaseProviderEffect(reservationId: string, evidence: "not_dispatched", client?: SupabaseClient): Promise<void> {
  const supabase = client ?? createServiceRoleClient();
  const { data, error } = await supabase.rpc("portal_release_provider_effect_service", { p_reservation_id: reservationId, p_evidence: evidence });
  if (error || data !== true) throw new Error(`provider effect release failed: ${error?.message ?? "transition not applied"}`);
}

export async function reconcileProviderEffect(
  receiptId: string,
  reservationId: string,
  evidence: "provider_rejected" | "reconciliation_absent" | "compensation_confirmed",
  providerReceiptRef: string,
  client?: SupabaseClient,
): Promise<void> {
  if (!UUID_V7_PATTERN.test(receiptId)) throw new Error("provider reconciliation receiptId must be a UUIDv7");
  if (providerReceiptRef.length < 8 || providerReceiptRef.length > 255) throw new Error("provider reconciliation receipt ref must be 8..255 characters");
  const supabase = client ?? createServiceRoleClient();
  const { data, error } = await supabase.rpc("portal_reconcile_provider_effect_service", {
    p_receipt_id: receiptId,
    p_reservation_id: reservationId,
    p_evidence: evidence,
    p_provider_receipt_ref: providerReceiptRef,
  });
  if (error || data !== true) throw new Error(`provider effect reconciliation failed: ${error?.message ?? "transition not applied"}`);
}

export function stableProviderReconciliationReceiptId(
  reservationId: string,
  evidence: "provider_rejected" | "reconciliation_absent" | "compensation_confirmed",
  providerReceiptRef: string,
): string {
  if (!UUID_V7_PATTERN.test(reservationId)) throw new Error("provider reservationId must be a UUIDv7");
  const suffix = createHash("sha256").update(`${reservationId}\u001f${evidence}\u001f${providerReceiptRef}`).digest("hex").slice(0, 12);
  return `${reservationId.slice(0, 24)}${suffix}`;
}

/**
 * Canonical, bounded evidence reference for provider-side termination. The
 * original provider ref remains on the reservation; an unusually long ref is
 * represented by a deterministic digest so the receipt always fits the SQL
 * contract instead of being silently truncated by one caller.
 */
export function providerTerminationReceiptRef(provider: PaidProvider, providerRef: string): string {
  if (!PROVIDER_REF_PATTERN.test(providerRef)) throw new Error("provider termination ref is invalid");
  const prefix = provider === "tavus" ? "tavus:end:" : "recall:leave:";
  const candidate = `${prefix}${providerRef}`;
  return candidate.length <= 255
    ? candidate
    : `${prefix}sha256:${createHash("sha256").update(providerRef).digest("hex")}`;
}

/**
 * Compensates a provider effect that was committed but could not be delivered
 * safely to the customer.
 *
 * The cleanup fence, billing void and provider termination are deliberately
 * independent attempts. In particular, a database/billing-void failure must
 * never strand a known paid provider resource. Capacity is released only when
 * all three durable facts are confirmed: cleanup_pending was persisted,
 * billing was voided while still unleased, and provider termination returned
 * successfully. A partial outcome remains behind cleanup_pending for the
 * reconciler and is surfaced as an AggregateError.
 */
export async function compensateCommittedProviderEffect(
  input: CompensateCommittedProviderEffectInput,
  dependencies: CompensateCommittedProviderEffectDependencies = {},
): Promise<void> {
  const persistCleanup = dependencies.markCleanupPending ?? markCleanupPending;
  const voidBilling = dependencies.voidUnleasedBillingUsage ?? voidUnleasedBillingUsage;
  const reconcile = dependencies.reconcileProviderEffect ?? reconcileProviderEffect;
  const failures: unknown[] = [];
  let cleanupPersisted = false;
  let billingVoided = false;
  let providerTerminated = false;

  try {
    await persistCleanup(input.reservationId, input.providerRef, input.failureCode);
    cleanupPersisted = true;
  } catch (error) {
    failures.push(error);
  }

  try {
    await voidBilling(input.reservationId, input.failureCode);
    billingVoided = true;
  } catch (error) {
    failures.push(error);
  }

  // This attempt is intentionally unconditional. A failed database fence or
  // a billing row being leased cannot justify leaving a known provider
  // resource running and accruing cost.
  try {
    await input.terminate();
    providerTerminated = true;
  } catch (error) {
    failures.push(error);
  }

  if (cleanupPersisted && billingVoided && providerTerminated) {
    const providerReceiptRef = providerTerminationReceiptRef(input.provider, input.providerRef);
    const receiptId = stableProviderReconciliationReceiptId(
      input.reservationId,
      "compensation_confirmed",
      providerReceiptRef,
    );
    try {
      await reconcile(
        receiptId,
        input.reservationId,
        "compensation_confirmed",
        providerReceiptRef,
      );
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, `provider ${input.provider} compensation remains pending`);
  }
}

export async function markCleanupPending(reservationId: string, providerRef: string, failureCode: string, client?: SupabaseClient): Promise<void> {
  const supabase = client ?? createServiceRoleClient();
  const { data, error } = await supabase.rpc("portal_mark_provider_effect_cleanup_pending_service", { p_reservation_id: reservationId, p_provider_ref: providerRef, p_failure_code: failureCode });
  if (error || data !== true) throw new Error(`provider cleanup fence failed: ${error?.message ?? "transition not applied"}`);
}

export async function completeProviderEffect(reservationId: string, client?: SupabaseClient): Promise<void> {
  const supabase = client ?? createServiceRoleClient();
  const { data, error } = await supabase.rpc("portal_complete_provider_effect_service", { p_reservation_id: reservationId });
  if (error || data !== true) throw new Error(`provider completion failed: ${error?.message ?? "transition not applied"}`);
}

export async function activateProviderEffectBilling(reservationId: string, client?: SupabaseClient): Promise<void> {
  const supabase = client ?? createServiceRoleClient();
  const { data, error } = await supabase.rpc("portal_activate_provider_effect_billing_service", { p_reservation_id: reservationId });
  const receipt = asRecord(data);
  if (error || receipt.activated !== true || receipt.customerDeliveryState !== "activated") {
    throw new Error(`provider effect billing activation failed: ${error?.message ?? "activation receipt missing"}`);
  }
}

export async function voidUnleasedBillingUsage(reservationId: string, reason: string, client?: SupabaseClient): Promise<void> {
  const supabase = client ?? createServiceRoleClient();
  const { data, error } = await supabase.rpc("portal_void_unleased_billing_usage_service", {
    p_reservation_id: reservationId,
    p_reason: reason,
  });
  if (error || data !== true) throw new Error(`billing usage void failed: ${error?.message ?? "transition not applied"}`);
}

export function deterministicProviderRejection(error: unknown): boolean {
  void error;
  // A provider HTTP response is not cryptographic evidence that no paid
  // effect was admitted upstream. Even 4xx can be emitted by proxies or by a
  // downstream validation step after allocation. Only `not_dispatched`,
  // proven before crossing the provider boundary, may release request-path
  // capacity. Every external failure remains unknown until reconciled.
  return false;
}

export async function fenceProviderFailure(reservationId: string, error: unknown, client?: SupabaseClient): Promise<void> {
  const code = typeof asRecord(error).code === "string" ? String(asRecord(error).code) : "provider_outcome_unknown";
  await markProviderEffectUnknown(reservationId, code, client);
}
