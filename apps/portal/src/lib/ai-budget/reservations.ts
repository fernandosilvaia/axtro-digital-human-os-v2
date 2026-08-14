import { createHash } from "node:crypto";

import { createUuidV7 } from "@axtro/domain";
import { TextGenerationError } from "@axtro/provider-openrouter";

export type AiUsageOperation =
  | "chat_generation"
  | "brain_generation"
  | "knowledge_query_embedding"
  | "knowledge_ingestion_embedding";

export interface AiUsageReservationLimits {
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxCostUsd: number;
}

export const AI_USAGE_LIMITS: Readonly<Record<AiUsageOperation, AiUsageReservationLimits>> = Object.freeze({
  chat_generation: Object.freeze({ maxInputTokens: 20_000, maxOutputTokens: 512, maxCostUsd: 0.05 }),
  brain_generation: Object.freeze({ maxInputTokens: 20_000, maxOutputTokens: 512, maxCostUsd: 0.05 }),
  knowledge_query_embedding: Object.freeze({ maxInputTokens: 1_000, maxOutputTokens: 0, maxCostUsd: 0.001 }),
  knowledge_ingestion_embedding: Object.freeze({ maxInputTokens: 20_000, maxOutputTokens: 0, maxCostUsd: 0.01 }),
});

/**
 * Modelo de geracao cujo envelope acima foi revisado. Trocar o modelo sem
 * trocar o rate card e os limites transacionais pode gastar acima da reserva;
 * portanto configuracao desconhecida falha antes do dispatch.
 */
export const OPENROUTER_GENERATION_MODEL = "anthropic/claude-haiku-4.5";
export const AI_USAGE_RATE_CARD_AS_OF = "2026-08-13";

export function configuredOpenRouterGenerationModel(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configured = (env.OPENROUTER_MODEL ?? OPENROUTER_GENERATION_MODEL).trim();
  if (configured !== OPENROUTER_GENERATION_MODEL) {
    throw new Error("OPENROUTER_MODEL is not covered by the active AI usage rate card");
  }
  return configured;
}

export interface AiUsageReservation {
  readonly id: string;
  readonly costEventId: string;
  readonly outcome: "reserved" | "replayed";
  readonly state: string;
  readonly providerRequestRef: string | null;
  readonly operation: AiUsageOperation;
}

export type AiUsageBeginResult =
  | { readonly allowed: true; readonly reservation: AiUsageReservation }
  | { readonly allowed: false; readonly reason: "capped" | "blocked_unknown" | "unavailable" };

interface RpcResult {
  readonly data: unknown;
  readonly error: { readonly message?: string } | null;
}

export interface AiUsageRpcClient {
  rpc(name: string, args: Readonly<Record<string, unknown>>): PromiseLike<RpcResult>;
}

export interface BeginAiUsageOptions {
  readonly client: AiUsageRpcClient;
  /** Tenant resolvido no servidor depois da autenticacao/autorizacao. */
  readonly tenantId: string;
  readonly operation: AiUsageOperation;
  readonly idempotencyKey: string;
  readonly agentId?: string | null;
  readonly sourceId?: string | null;
}

export type ReservedAiUsageExecution<T> =
  | { readonly outcome: "committed"; readonly value: T }
  | { readonly outcome: "denied"; readonly reason: "capped" | "blocked_unknown" | "unavailable" }
  | { readonly outcome: "not_acquired" }
  | { readonly outcome: "commit_pending" };

export interface ExecuteReservedAiUsageOptions<T> extends BeginAiUsageOptions {
  readonly execute: () => Promise<T>;
  readonly usage: (value: T) => {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly reportedCostUsd?: number;
  };
}

export function stableAiUsageIdempotencyKey(operation: AiUsageOperation, material: string): string {
  const digest = createHash("sha256").update(material, "utf8").digest("hex");
  return `ai:${operation}:${digest}`;
}

const PROVIDER_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,199}$/;

/**
 * Escopo de uma requisicao provider-to-server JA autenticada. Tavus pode
 * reenviar o mesmo turno com `Idempotency-Key`/`X-Request-Id`; nesse caso a
 * identidade permanece estavel. Quando o provider nao oferece identidade,
 * cada request HTTP recebe um UUID novo: duas conversas distintas com as
 * mesmas mensagens nunca colidem para sempre.
 */
export function aiProviderRequestScope(authenticatedProviderRequestId: string | null | undefined): string {
  const candidate = authenticatedProviderRequestId?.trim() ?? "";
  return PROVIDER_REQUEST_ID_PATTERN.test(candidate)
    ? `provider:${candidate}`
    : `request:${createUuidV7()}`;
}

export async function beginAiUsage(options: BeginAiUsageOptions): Promise<AiUsageBeginResult> {
  if (options.tenantId.trim().length === 0) {
    return { allowed: false, reason: "unavailable" };
  }
  const reservationId = createUuidV7();
  const costEventId = createUuidV7();
  const limits = AI_USAGE_LIMITS[options.operation];
  const { data, error } = await options.client.rpc("portal_begin_ai_usage_reservation_service", {
      p_id: reservationId,
      p_tenant_id: options.tenantId,
      p_agent_id: options.agentId ?? null,
      p_source_id: options.sourceId ?? null,
      p_idempotency_key: options.idempotencyKey,
      p_operation: options.operation,
      p_max_input_tokens: limits.maxInputTokens,
      p_max_output_tokens: limits.maxOutputTokens,
      p_max_cost_usd: limits.maxCostUsd,
      p_cost_event_id: costEventId,
    });
  if (error || data === null || typeof data !== "object") return { allowed: false, reason: "unavailable" };
  const record = data as Record<string, unknown>;
  const outcome = record.outcome;
  if (outcome === "capped" || outcome === "blocked_unknown") return { allowed: false, reason: outcome };
  if (outcome !== "reserved" && outcome !== "replayed") return { allowed: false, reason: "unavailable" };
  const returnedId = typeof record.reservationId === "string" ? record.reservationId : reservationId;
  return {
    allowed: true,
    reservation: {
      id: returnedId,
      costEventId,
      outcome,
      state: typeof record.state === "string" ? record.state : "reserved",
      providerRequestRef: typeof record.providerRequestRef === "string" ? record.providerRequestRef : null,
      operation: options.operation,
    },
  };
}

/**
 * Executa um efeito pago apenas depois de a reserva e o fence transacionais
 * vencerem. O callback `execute` é a fronteira do provider: nenhum caminho
 * negado pelo banco consegue alcançá-lo.
 */
export async function executeReservedAiUsage<T>(
  options: ExecuteReservedAiUsageOptions<T>,
): Promise<ReservedAiUsageExecution<T>> {
  const begin = await beginAiUsage(options);
  if (!begin.allowed) return { outcome: "denied", reason: begin.reason };

  const reservation = begin.reservation;
  const acquired = await markAiUsageInFlight(options.client, reservation);
  if (!acquired) return { outcome: "not_acquired" };

  let value: T;
  try {
    value = await options.execute();
  } catch (error) {
    await recordAiUsageProviderFailure(options.client, reservation, error);
    throw error;
  }

  const committed = await commitAiUsage(options.client, reservation, options.usage(value));
  if (!committed) {
    await markAiUsageUnknown(options.client, reservation, "usage_commit_failed");
    return { outcome: "commit_pending" };
  }
  return { outcome: "committed", value };
}

export async function markAiUsageInFlight(client: AiUsageRpcClient, reservation: AiUsageReservation): Promise<boolean> {
  if (reservation.outcome === "replayed" && reservation.state !== "reserved") return false;
  const { data, error } = await client.rpc("portal_mark_ai_usage_in_flight_service", { p_id: reservation.id });
  if (error || data === null || typeof data !== "object") return false;
  return (data as Record<string, unknown>).acquired === true;
}

export async function commitAiUsage(
  client: AiUsageRpcClient,
  reservation: AiUsageReservation,
  usage: { readonly inputTokens: number; readonly outputTokens: number; readonly reportedCostUsd?: number },
): Promise<boolean> {
  try {
    const { data, error } = await client.rpc("portal_commit_ai_usage_service", {
        p_id: reservation.id,
        p_actual_input_tokens: usage.inputTokens,
        p_actual_output_tokens: usage.outputTokens,
        p_reported_cost_usd: usage.reportedCostUsd ?? null,
      });
    return error === null && data !== null && typeof data === "object" && (data as Record<string, unknown>).committed === true;
  } catch {
    // Um reject/timeout do RPC depois da resposta do provider nao pode deixar
    // `provider_in_flight` silencioso. A transicao e estrita: se o commit tiver
    // sido aplicado apesar da resposta perdida, o banco recusa a mudanca e o
    // caller recebe erro, sem inventar um receipt.
    await markAiUsageUnknown(client, reservation, "usage_commit_rpc_failed");
    return false;
  }
}

export async function releaseAiUsageNotDispatched(client: AiUsageRpcClient, reservation: AiUsageReservation): Promise<void> {
  const receipt = await client.rpc("portal_release_ai_usage_service", {
    p_id: reservation.id,
    p_evidence: "not_dispatched",
  });
  requireTrueReceipt(receipt, "release_not_dispatched");
}

export async function recordAiUsageProviderFailure(
  client: AiUsageRpcClient,
  reservation: AiUsageReservation,
  error: unknown,
): Promise<void> {
  // O adapter OpenRouter agrega qualquer HTTP <500 em `provider_rejected`
  // (inclusive 408/409/425/429). Depois do fence isso não prova ausência de
  // cobrança; sem receipt/status HTTP estruturado, toda falha pós-dispatch
  // permanece unknown até reconciliação. Só `not_dispatched`, antes do
  // fence, pode liberar no request path.
  await markAiUsageUnknown(client, reservation, aiFailureCode(error));
}

export async function markAiUsageUnknown(
  client: AiUsageRpcClient,
  reservation: AiUsageReservation,
  failureCode: string,
): Promise<void> {
  const receipt = await client.rpc("portal_mark_ai_usage_unknown_service", {
    p_id: reservation.id,
    p_failure_code: failureCode.slice(0, 80),
  });
  requireTrueReceipt(receipt, "mark_unknown");
}

function requireTrueReceipt(receipt: RpcResult, transition: string): void {
  if (receipt.error !== null || receipt.data !== true) {
    throw new Error(`AI usage ${transition} did not return a durable success receipt`);
  }
}

function aiFailureCode(error: unknown): string {
  if (error instanceof TextGenerationError) return error.code;
  return "ambiguous_provider_failure";
}
