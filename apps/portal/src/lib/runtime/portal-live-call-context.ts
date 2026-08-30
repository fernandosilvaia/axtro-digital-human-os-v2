import { createServiceRoleClient } from "../supabase/service.ts";

/**
 * ADR-041, "Resolver sessão, presenter e geração de uma chamada já viva sem
 * recriar o acoplamento que ADR-039 já proíbe". Deliberadamente um terceiro
 * módulo, fora de portal-channel-runtime-bridge.ts e de
 * portal-business-action-bridge.ts: este arquivo não é dono de nenhum dos
 * dois domínios, só lê a junção de tabelas já duráveis que uma admissão de
 * canal (0043) já deixou gravadas, e nunca checa
 * PORTAL_RUNTIME_BRIDGE_ENABLED nem PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED --
 * a checagem da segunda continua acontecendo, como hoje, dentro de
 * admitBusinessAction, no passo seguinte do funil. Um revisor lendo
 * portal-business-action-bridge.ts deve continuar vendo zero import de
 * portal-channel-runtime-bridge.ts; colocar esta função aqui em vez de
 * dentro de um dos dois bridges existentes é o que preserva essa garantia
 * visual.
 *
 * resolveLiveBusinessActionCallContext recebe o idempotencyKey já pronto
 * (o chamador monta paidEffectIntentKey(commandId, "tavus:video" |
 * "tavus:presentation") antes de chamar esta função -- este módulo não
 * conhece paidEffectIntentKey nem o formato do commandId original) e chama
 * a RPC de leitura pura portal_business_action_call_context_service
 * (migration 0054), que resolve sessionId/presenterId/generation a partir
 * da mesma reserva que startVideoConversation/stopVideoConversation já
 * usam para reencontrar a chamada viva, sem nunca chamar
 * portal_admit_runtime_channel_service.
 */
export const PORTAL_LIVE_CALL_CONTEXT_RPC = "portal_business_action_call_context_service";

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type LiveBusinessActionCallContextOutcomeCode = "found" | "not_found" | "session_terminal" | "service_unavailable";

export interface ResolveLiveBusinessActionCallContextInput {
  readonly tenantId: string;
  readonly agentId: string;
  /** Já pronto -- ver paidEffectIntentKey(commandId, discriminator) em apps/portal/src/lib/paid-effects/index.ts. */
  readonly idempotencyKey: string;
}

export interface LiveBusinessActionCallContext {
  readonly sessionId: string;
  /** Lido fresco de sessions.active_presenter_id no momento da chamada, nunca o presenter_id estático gravado no binding na admissão (o presenter pode ter mudado por handoff). */
  readonly presenterId: string;
  readonly generation: number;
}

export type ResolveLiveBusinessActionCallContextResult =
  | Readonly<{ readonly outcome: "found"; readonly context: LiveBusinessActionCallContext }>
  | Readonly<{ readonly outcome: "not_found" | "session_terminal" | "service_unavailable" }>;

export interface PortalLiveCallContextRpcResult {
  readonly data: unknown;
  readonly error: { readonly message?: string } | null;
}

export interface PortalLiveCallContextRpcClient {
  rpc(name: string, parameters?: Readonly<Record<string, unknown>>): PromiseLike<PortalLiveCallContextRpcResult>;
}

export interface ResolveLiveBusinessActionCallContextDependencies {
  readonly rpc?: PortalLiveCallContextRpcClient;
}

export class PortalLiveCallContextInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortalLiveCallContextInputError";
  }
}

export class PortalLiveCallContextServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortalLiveCallContextServiceError";
  }
}

function ownRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? (value as Record<string, unknown>) : null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === "string" ? (record[key] as string) : null;
}

function readGeneration(record: Record<string, unknown>): number | null {
  const value = record.generation;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function assertUuidV7(value: unknown, name: string): string {
  if (typeof value !== "string" || !UUID_V7_PATTERN.test(value)) throw new PortalLiveCallContextInputError(`${name} must be a UUIDv7`);
  return value;
}

function assertIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new PortalLiveCallContextInputError("idempotencyKey is required");
  return value;
}

async function rpc(client: PortalLiveCallContextRpcClient, name: string, parameters: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
  const response = await client.rpc(name, parameters);
  if (response.error !== null) throw new PortalLiveCallContextServiceError(`live call context ${name} failed: ${response.error.message ?? "unknown error"}`);
  const result = ownRecord(response.data);
  if (result === null) throw new PortalLiveCallContextServiceError(`live call context ${name} returned an invalid response`);
  return result;
}

function declared<TCode extends "not_found" | "session_terminal" | "service_unavailable">(outcome: TCode): Readonly<{ readonly outcome: TCode }> {
  return Object.freeze({ outcome });
}

/** Production convenience wrapper. Prefer an injected `rpc` dependency in tests. */
export async function resolveLiveBusinessActionCallContext(
  input: ResolveLiveBusinessActionCallContextInput,
  dependencies: ResolveLiveBusinessActionCallContextDependencies = {},
): Promise<ResolveLiveBusinessActionCallContextResult> {
  const client = dependencies.rpc ?? createServiceRoleClient();
  const tenantId = assertUuidV7(input.tenantId, "tenantId");
  const agentId = assertUuidV7(input.agentId, "agentId");
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);

  try {
    const record = await rpc(client, PORTAL_LIVE_CALL_CONTEXT_RPC, {
      p_tenant_id: tenantId,
      p_agent_id: agentId,
      p_idempotency_key: idempotencyKey,
    });
    const outcome = record.outcome;
    if (outcome === "not_found" || outcome === "session_terminal") return declared(outcome);
    if (outcome !== "found") return declared("service_unavailable");

    const sessionId = readString(record, "sessionId");
    const presenterId = readString(record, "presenterId");
    const generation = readGeneration(record);
    if (sessionId === null || presenterId === null || generation === null) return declared("service_unavailable");

    const context: LiveBusinessActionCallContext = Object.freeze({
      sessionId: assertUuidV7(sessionId, "sessionId"),
      presenterId: assertUuidV7(presenterId, "presenterId"),
      generation,
    });
    return Object.freeze({ outcome: "found", context });
  } catch (error) {
    if (error instanceof PortalLiveCallContextInputError) throw error;
    return declared("service_unavailable");
  }
}
