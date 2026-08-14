import { isUuidV7 } from "@axtro/domain";

import { constantTimeEquals } from "../security.ts";
import { createServiceRoleClient } from "../supabase/service.ts";

const PROVIDER_RECEIPT_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/-]{7,254}$/;
const BACKLOG_KEYS = Object.freeze([
  "reserved",
  "providerInFlight",
  "unknown",
  "unknownMaxTokens",
  "unknownMaxCostUsd",
  "oldestProviderInFlightAgeSeconds",
  "oldestUnknownAgeSeconds",
  "receiptCount",
] as const);
const RECONCILIATION_KEYS = Object.freeze([
  "receiptId",
  "reservationId",
  "evidence",
  "providerReceiptRef",
  "actualInputTokens",
  "actualOutputTokens",
  "reportedCostUsd",
] as const);
const RECEIPT_KEYS = Object.freeze(["reconciled", "replayed", "state", "costEventId"] as const);

export type AiUsageReconciliationEvidence =
  | "provider_invoice_no_charge"
  | "provider_invoice_usage_confirmed";

export interface AiUsageReconciliationInput {
  readonly receiptId: string;
  readonly reservationId: string;
  readonly evidence: AiUsageReconciliationEvidence;
  readonly providerReceiptRef: string;
  readonly actualInputTokens: number | null;
  readonly actualOutputTokens: number | null;
  readonly reportedCostUsd: number | null;
}

export interface AiUsageReconciliationBacklog {
  readonly reserved: number;
  readonly providerInFlight: number;
  readonly unknown: number;
  readonly unknownMaxTokens: number;
  readonly unknownMaxCostUsd: number;
  readonly oldestProviderInFlightAgeSeconds: number;
  readonly oldestUnknownAgeSeconds: number;
  readonly receiptCount: number;
}

export type AiUsageReconciliationReceipt =
  | {
      readonly reconciled: true;
      readonly replayed: boolean;
      readonly state: "released";
      readonly costEventId: null;
    }
  | {
      readonly reconciled: true;
      readonly replayed: boolean;
      readonly state: "committed";
      readonly costEventId: string;
    };

interface RpcResult {
  readonly data: unknown;
  readonly error: { readonly message?: string; readonly code?: string } | null;
}

export interface AiUsageReconciliationRpcClient {
  rpc(name: string, parameters?: Readonly<Record<string, unknown>>): PromiseLike<RpcResult>;
}

export type AiUsageReconciliationAuthorization = "authorized" | "not_configured" | "unauthorized";

export class AiUsageReconciliationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUsageReconciliationUnavailableError";
  }
}

/** Pure authorization seam. The operator secret never becomes database authority. */
export function authorizeAiUsageReconciliation(
  authorizationHeader: string | null,
  expectedSecret: string | undefined,
): AiUsageReconciliationAuthorization {
  const expected = (expectedSecret ?? "").trim();
  if (expected.length < 24) return "not_configured";
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorizationHeader ?? "");
  if (!match || !constantTimeEquals(match[1] ?? "", expected)) return "unauthorized";
  return "authorized";
}

export function parseAiUsageReconciliationInput(value: unknown): AiUsageReconciliationInput {
  if (!isExactRecord(value, RECONCILIATION_KEYS)) {
    throw new TypeError("AI usage reconciliation request must have the exact bounded shape");
  }
  if (
    !isUuidV7(value.receiptId)
    || !isUuidV7(value.reservationId)
    || typeof value.providerReceiptRef !== "string"
    || !PROVIDER_RECEIPT_REF_PATTERN.test(value.providerReceiptRef)
  ) {
    throw new TypeError("AI usage reconciliation request has invalid receipt evidence");
  }

  const evidence = value.evidence;
  const actualInputTokens = value.actualInputTokens;
  const actualOutputTokens = value.actualOutputTokens;
  const reportedCostUsd = value.reportedCostUsd;
  if (evidence === "provider_invoice_no_charge") {
    if (actualInputTokens !== null || actualOutputTokens !== null || reportedCostUsd !== null) {
      throw new TypeError("no-charge provider evidence cannot carry usage");
    }
  } else if (evidence === "provider_invoice_usage_confirmed") {
    if (
      !isNonNegativeSafeInteger(actualInputTokens)
      || !isNonNegativeSafeInteger(actualOutputTokens)
      || actualInputTokens + actualOutputTokens <= 0
      || !isNonNegativeFiniteNumber(reportedCostUsd)
    ) {
      throw new TypeError("confirmed provider invoice requires non-zero bounded usage and cost");
    }
  } else {
    throw new TypeError("AI usage reconciliation evidence is invalid");
  }

  return {
    receiptId: value.receiptId,
    reservationId: value.reservationId,
    evidence,
    providerReceiptRef: value.providerReceiptRef,
    actualInputTokens,
    actualOutputTokens,
    reportedCostUsd,
  };
}

export async function readAiUsageReconciliationBacklog(
  client: AiUsageReconciliationRpcClient = createServiceRoleClient() as AiUsageReconciliationRpcClient,
): Promise<AiUsageReconciliationBacklog> {
  try {
    const result = await client.rpc("portal_ai_usage_reconciliation_backlog_service");
    if (result.error !== null) throw new AiUsageReconciliationUnavailableError("AI usage backlog RPC failed");
    return parseBacklog(result.data);
  } catch (error) {
    if (error instanceof AiUsageReconciliationUnavailableError) throw error;
    throw new AiUsageReconciliationUnavailableError("AI usage backlog RPC failed");
  }
}

export async function manuallyReconcileAiUsage(
  input: AiUsageReconciliationInput,
  client: AiUsageReconciliationRpcClient = createServiceRoleClient() as AiUsageReconciliationRpcClient,
): Promise<AiUsageReconciliationReceipt> {
  try {
    const result = await client.rpc("portal_reconcile_ai_usage_service", {
      p_receipt_id: input.receiptId,
      p_reservation_id: input.reservationId,
      p_evidence: input.evidence,
      p_provider_receipt_ref: input.providerReceiptRef,
      p_actual_input_tokens: input.actualInputTokens,
      p_actual_output_tokens: input.actualOutputTokens,
      p_reported_cost_usd: input.reportedCostUsd,
    });
    if (result.error !== null) throw new AiUsageReconciliationUnavailableError("AI usage reconciliation RPC failed");
    return parseReceipt(result.data, input.evidence);
  } catch (error) {
    if (error instanceof AiUsageReconciliationUnavailableError) throw error;
    throw new AiUsageReconciliationUnavailableError("AI usage reconciliation RPC failed");
  }
}

function parseBacklog(value: unknown): AiUsageReconciliationBacklog {
  if (!isExactRecord(value, BACKLOG_KEYS)) {
    throw new AiUsageReconciliationUnavailableError("AI usage backlog returned a malformed receipt");
  }
  for (const key of BACKLOG_KEYS) {
    const candidate = value[key];
    const valid = key === "unknownMaxCostUsd"
      ? isNonNegativeFiniteNumber(candidate)
      : isNonNegativeSafeInteger(candidate);
    if (!valid) throw new AiUsageReconciliationUnavailableError("AI usage backlog returned a malformed receipt");
  }
  return value as unknown as AiUsageReconciliationBacklog;
}

function parseReceipt(value: unknown, evidence: AiUsageReconciliationEvidence): AiUsageReconciliationReceipt {
  if (!isExactRecord(value, RECEIPT_KEYS) || value.reconciled !== true || typeof value.replayed !== "boolean") {
    throw new AiUsageReconciliationUnavailableError("AI usage reconciliation returned a malformed receipt");
  }
  if (evidence === "provider_invoice_no_charge") {
    if (value.state !== "released" || value.costEventId !== null) {
      throw new AiUsageReconciliationUnavailableError("AI usage reconciliation returned inconsistent no-charge evidence");
    }
    return value as unknown as AiUsageReconciliationReceipt;
  }
  if (value.state !== "committed" || !isUuidV7(value.costEventId)) {
    throw new AiUsageReconciliationUnavailableError("AI usage reconciliation returned inconsistent invoice evidence");
  }
  return value as unknown as AiUsageReconciliationReceipt;
}

function isExactRecord<const Keys extends readonly string[]>(
  value: unknown,
  expectedKeys: Keys,
): value is Record<Keys[number], unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
