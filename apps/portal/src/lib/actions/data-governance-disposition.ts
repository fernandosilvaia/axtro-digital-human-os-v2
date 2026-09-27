"use server";

/**
 * M6-04, ADR-046: camada de aplicação da fatia 1 combinada nesta sessão com
 * o Fernando (achado D-V2-182). Escopo deliberadamente estreito:
 *
 *   - só `scope='tenant'`, só os 3 `purposeCode` que a migration 0059 já
 *     permite pra esse escopo (`contract_termination`/`retention_expiry`/
 *     `operator_correction`) -- `scope='data_subject'` exige a máquina de
 *     vínculo de titular (HMAC linking + atestação de cobertura), uma
 *     segunda fatia maior, fora do escopo combinado agora;
 *   - a autorização é 100% a das próprias RPCs `_authenticated` da 0059:
 *     `auth.uid()` precisa resolver a um `tenant_admin` do MESMO tenant cujo
 *     dado seria disposto (`app.data_governance_authenticated_admin()`).
 *     Não existe aqui, nem deveria existir, nenhum caminho de "operador
 *     Axtro decide pelo cliente" -- a própria ADR-046 desenha assim de
 *     propósito (só o próprio tenant pede e aprova a disposição dos
 *     próprios dados). Na prática, hoje, só o tenant interno da Axtro tem
 *     alguém testando este fluxo;
 *   - esta camada nunca avança um pedido além de `authorized`. Ela nunca
 *     chama nenhuma RPC de inventário/aplicação/verificação -- essas
 *     exigem `apps/workflow-worker` rodando, que continua fora do
 *     `railway.json` (decisão separada, já rastreada em
 *     `docs/NEEDS_CONNECTION.md`). Nada irreversível é alcançável a partir
 *     daqui;
 *   - `attestationReady` é `false` em todo ambiente real hoje: as 7
 *     autoridades verificadoras externas (armazenamento de objeto, cache,
 *     índice de embedding, cópia em provider terceiro, identidade no Auth,
 *     segredo no Vault, backup) nunca foram provisionadas fora do harness
 *     de teste local. Por isso `requestTenantDataGovernanceDisposition`
 *     falha fechado com `not_ready` em produção até essa peça de
 *     infraestrutura existir -- modo fake primeiro, mesmo padrão do Stripe
 *     Connect e do Google Calendar OAuth deste mesmo repositório.
 */
import { createUuidV7, UUID_V7_PATTERN } from "@axtro/domain";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { isTenantDispositionPurposeCode, type TenantDispositionPurposeCode } from "@/lib/data-governance-purpose-codes";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient, ServiceRoleUnavailableError } from "@/lib/supabase/service";

export interface DataGovernanceDispositionStatus {
  readonly tenantId: string;
  readonly requestId: string;
  readonly scope: string;
  readonly state: string;
  readonly purposeCode: string;
  readonly subjectId: string | null;
  readonly requiredApprovals: number;
  readonly approvedCount: number;
  readonly deniedCount: number;
  readonly policyFingerprint: string;
  readonly inventoryFingerprint: string;
  readonly commandFingerprint: string;
  readonly authorizationExpiresAt: string | null;
  readonly authorizedAt: string | null;
  readonly completedAt: string | null;
}

export type ActiveDataGovernanceDispositionResult =
  | Readonly<{ readonly outcome: "none" }>
  | Readonly<{ readonly outcome: "found"; readonly status: DataGovernanceDispositionStatus }>
  | Readonly<{ readonly outcome: "unauthorized" }>
  | Readonly<{ readonly outcome: "service_unavailable" }>;

export type RequestDataGovernanceDispositionResult =
  | Readonly<{ readonly outcome: "requested"; readonly status: DataGovernanceDispositionStatus }>
  /** Nenhuma autoridade verificadora externa provisionada (todo ambiente real hoje) ou catálogo com drift. */
  | Readonly<{ readonly outcome: "not_ready"; readonly reason: "catalog_incomplete" | "attestation_not_ready" }>
  /** `data_governance_one_active_request_per_tenant_idx`: só um pedido não-terminal por tenant. */
  | Readonly<{ readonly outcome: "active_request_exists" }>
  | Readonly<{ readonly outcome: "tenant_not_admissible" }>
  | Readonly<{ readonly outcome: "unauthorized" }>
  | Readonly<{ readonly outcome: "service_unavailable" }>;

export type ApproveDataGovernanceDispositionResult =
  | Readonly<{ readonly outcome: "recorded"; readonly status: DataGovernanceDispositionStatus }>
  | Readonly<{ readonly outcome: "not_approvable" }>
  | Readonly<{ readonly outcome: "self_approval_blocked" }>
  | Readonly<{ readonly outcome: "unauthorized" }>
  | Readonly<{ readonly outcome: "service_unavailable" }>;

export type CancelDataGovernanceDispositionResult =
  | Readonly<{ readonly outcome: "cancelled" }>
  | Readonly<{ readonly outcome: "not_cancellable" }>
  | Readonly<{ readonly outcome: "unauthorized" }>
  | Readonly<{ readonly outcome: "service_unavailable" }>;

interface RpcClient {
  rpc(name: string, parameters?: Readonly<Record<string, unknown>>): PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
}

export interface DataGovernanceDispositionDependencies {
  readonly authenticatedClient?: RpcClient;
  readonly serviceClient?: RpcClient;
  readonly idGenerator?: () => string;
}

type RpcOutcome =
  | Readonly<{ readonly ok: true; readonly data: Record<string, unknown> }>
  | Readonly<{ readonly ok: false; readonly code: string; readonly message: string }>;

function ownRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? (value as Record<string, unknown>) : null;
}

/** Nunca lança: todo erro de RPC (esperado ou de transporte) vira um `code`/`message` declarados pro chamador classificar. */
async function callRpc(client: RpcClient, name: string, parameters: Readonly<Record<string, unknown>>): Promise<RpcOutcome> {
  try {
    const { data, error } = await client.rpc(name, parameters);
    if (error !== null) return { ok: false, code: error.code ?? "unknown", message: error.message };
    const record = ownRecord(data);
    if (record === null) return { ok: false, code: "malformed_response", message: "malformed response" };
    return { ok: true, data: record };
  } catch {
    return { ok: false, code: "transport_failure", message: "transport failure" };
  }
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" ? value : null;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function parseStatus(record: Record<string, unknown>): DataGovernanceDispositionStatus | null {
  const tenantId = readString(record, "tenantId");
  const requestId = readString(record, "requestId");
  const scope = readString(record, "scope");
  const state = readString(record, "state");
  const purposeCode = readString(record, "purposeCode");
  const requiredApprovals = readNumber(record, "requiredApprovals");
  const approvedCount = readNumber(record, "approvedCount");
  const deniedCount = readNumber(record, "deniedCount");
  const policyFingerprint = readString(record, "policyFingerprint");
  const inventoryFingerprint = readString(record, "inventoryFingerprint");
  const commandFingerprint = readString(record, "commandFingerprint");
  if (
    tenantId === null || requestId === null || scope === null || state === null || purposeCode === null ||
    requiredApprovals === null || approvedCount === null || deniedCount === null ||
    policyFingerprint === null || inventoryFingerprint === null || commandFingerprint === null
  ) return null;
  return Object.freeze({
    tenantId, requestId, scope, state, purposeCode,
    subjectId: readString(record, "subjectId"),
    requiredApprovals, approvedCount, deniedCount,
    policyFingerprint, inventoryFingerprint, commandFingerprint,
    authorizationExpiresAt: readString(record, "authorizationExpiresAt"),
    authorizedAt: readString(record, "authorizedAt"),
    completedAt: readString(record, "completedAt"),
  });
}

async function fetchStatus(client: RpcClient, requestId: string): Promise<{ readonly status: DataGovernanceDispositionStatus } | { readonly errorOutcome: "unauthorized" | "service_unavailable" }> {
  const result = await callRpc(client, "portal_data_governance_status_authenticated", { p_request_id: requestId });
  if (!result.ok) return { errorOutcome: result.code === "42501" ? "unauthorized" : "service_unavailable" };
  const status = parseStatus(result.data);
  if (status === null) return { errorOutcome: "service_unavailable" };
  return { status };
}

/**
 * Descobre o pedido ativo do tenant (no máximo um, ver
 * `data_governance_one_active_request_per_tenant_idx`) sem exigir que o
 * chamador já saiba o `requestId` -- é o que permite um SEGUNDO
 * `tenant_admin`, que não foi quem abriu o pedido, achar e aprovar o mesmo
 * pedido pela tela.
 */
export async function getActiveTenantDataGovernanceDisposition(
  dependencies: DataGovernanceDispositionDependencies = {},
): Promise<ActiveDataGovernanceDispositionResult> {
  const authenticatedClient = dependencies.authenticatedClient ?? (await createClient());
  const activeResult = await callRpc(authenticatedClient, "portal_data_governance_active_request_authenticated", {});
  if (!activeResult.ok) return Object.freeze({ outcome: activeResult.code === "42501" ? "unauthorized" : "service_unavailable" });
  const requestId = readString(activeResult.data, "requestId");
  if (requestId === null) return Object.freeze({ outcome: "none" });
  const statusResult = await fetchStatus(authenticatedClient, requestId);
  if ("errorOutcome" in statusResult) return Object.freeze({ outcome: statusResult.errorOutcome });
  return Object.freeze({ outcome: "found", status: statusResult.status });
}

/**
 * Abre um pedido `scope=tenant` novo. Nunca chega a existir se
 * `attestationReady`/`catalogComplete` não passarem -- ver o cabeçalho do
 * arquivo, é o desfecho esperado em todo ambiente real hoje.
 */
export async function requestTenantDataGovernanceDisposition(
  purposeCode: TenantDispositionPurposeCode,
  dependencies: DataGovernanceDispositionDependencies = {},
): Promise<RequestDataGovernanceDispositionResult> {
  const authenticatedClient = dependencies.authenticatedClient ?? (await createClient());
  const serviceClient = dependencies.serviceClient ?? createServiceRoleClientSafely();
  if (serviceClient === null) return Object.freeze({ outcome: "service_unavailable" });
  const idGenerator = dependencies.idGenerator ?? createUuidV7;

  const requestId = idGenerator();
  const policyDecisionId = idGenerator();

  const prepareResult = await callRpc(authenticatedClient, "portal_prepare_data_governance_request_authenticated", {
    p_request_id: requestId, p_scope: "tenant", p_subject_id: null,
    p_requested_action: "irreversible_delete", p_purpose_code: purposeCode,
  });
  if (!prepareResult.ok) return Object.freeze({ outcome: prepareResult.code === "42501" ? "unauthorized" : "service_unavailable" });
  const tenantId = readString(prepareResult.data, "tenantId");
  const policyVersion = readString(prepareResult.data, "policyVersion");
  const inventoryVersion = readString(prepareResult.data, "inventoryVersion");
  const policyFingerprint = readString(prepareResult.data, "policyFingerprint");
  const inventoryFingerprint = readString(prepareResult.data, "inventoryFingerprint");
  const commandFingerprint = readString(prepareResult.data, "commandFingerprint");
  const catalogComplete = readBoolean(prepareResult.data, "catalogComplete");
  const attestationReady = readBoolean(prepareResult.data, "attestationReady");
  if (
    tenantId === null || policyVersion === null || inventoryVersion === null || policyFingerprint === null ||
    inventoryFingerprint === null || commandFingerprint === null || catalogComplete === null || attestationReady === null
  ) return Object.freeze({ outcome: "service_unavailable" });
  if (!catalogComplete) return Object.freeze({ outcome: "not_ready", reason: "catalog_incomplete" });
  if (!attestationReady) return Object.freeze({ outcome: "not_ready", reason: "attestation_not_ready" });

  const requestResult = await callRpc(authenticatedClient, "portal_request_data_governance_authenticated", {
    p_request_id: requestId, p_policy_decision_id: policyDecisionId, p_scope: "tenant", p_subject_id: null,
    p_requested_action: "irreversible_delete", p_purpose_code: purposeCode,
    p_policy_version: policyVersion, p_policy_fingerprint: policyFingerprint,
    p_inventory_version: inventoryVersion, p_inventory_fingerprint: inventoryFingerprint,
    p_command_fingerprint: commandFingerprint,
  });
  if (!requestResult.ok) {
    if (requestResult.code === "42501") return Object.freeze({ outcome: "unauthorized" });
    if (requestResult.code === "23505") return Object.freeze({ outcome: "active_request_exists" });
    if (requestResult.code === "55000") return Object.freeze({ outcome: "tenant_not_admissible" });
    return Object.freeze({ outcome: "service_unavailable" });
  }

  // Passo automático de política: nesta versão não existe nenhuma regra
  // discricionária (nenhuma tabela de política é consultada dentro de
  // `portal_decide_data_governance_policy_service`) -- toda solicitação que
  // passou pela validação de `portal_request_data_governance_authenticated`
  // já está bem formada, então decidir 'allow' aqui é determinístico, nunca
  // uma escolha de negócio inventada por esta camada.
  const authorizationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const decideResult = await callRpc(serviceClient, "portal_decide_data_governance_policy_service", {
    p_tenant_id: tenantId, p_request_id: requestId, p_policy_decision_id: policyDecisionId,
    p_decision: "allow", p_reason_code: "policy_allowed",
    p_policy_fingerprint: policyFingerprint, p_authorization_expires_at: authorizationExpiresAt,
  });
  if (!decideResult.ok) return Object.freeze({ outcome: "service_unavailable" });

  const statusResult = await fetchStatus(authenticatedClient, requestId);
  if ("errorOutcome" in statusResult) return Object.freeze({ outcome: statusResult.errorOutcome === "unauthorized" ? "unauthorized" : "service_unavailable" });
  return Object.freeze({ outcome: "requested", status: statusResult.status });
}

/**
 * Registra a aprovação (ou negação) de um `tenant_admin`. Depois de um
 * `approve`, tenta autorizar de imediato -- se o quorum ainda não estiver
 * completo, `portal_authorize_data_governance_request_service` rejeita com
 * 42501/55000, o que aqui é um resultado esperado ("ainda falta a segunda
 * aprovação"), nunca um erro.
 */
export async function approveTenantDataGovernanceDisposition(
  requestId: string,
  decision: "approve" | "deny",
  dependencies: DataGovernanceDispositionDependencies = {},
): Promise<ApproveDataGovernanceDispositionResult> {
  if (!UUID_V7_PATTERN.test(requestId)) return Object.freeze({ outcome: "unauthorized" });
  const authenticatedClient = dependencies.authenticatedClient ?? (await createClient());
  const idGenerator = dependencies.idGenerator ?? createUuidV7;

  const beforeStatus = await fetchStatus(authenticatedClient, requestId);
  if ("errorOutcome" in beforeStatus) return Object.freeze({ outcome: beforeStatus.errorOutcome });
  if (beforeStatus.status.state !== "approval_pending") return Object.freeze({ outcome: "not_approvable" });

  const approvalId = idGenerator();
  const approveResult = await callRpc(authenticatedClient, "portal_approve_data_governance_authenticated", {
    p_request_id: requestId, p_approval_id: approvalId, p_decision: decision,
    p_command_fingerprint: beforeStatus.status.commandFingerprint,
  });
  if (!approveResult.ok) {
    // 42501 é reaproveitado por duas checagens distintas da mesma RPC
    // (autor não pode aprovar o próprio pedido de exclusão de tenant, e
    // comando/policy fora da janela de autorização): o código sozinho não
    // distingue as duas, então casa pelo texto exato da exceção. Exceção
    // deliberada ao padrão de só usar `code`, feita porque mintar um
    // SQLSTATE novo só pra esta regra de negócio pareceu mais frágil do
    // que casar a mensagem literal que a própria RPC sempre devolve.
    if (approveResult.code === "42501" && approveResult.message === "the request author cannot approve their own tenant deletion request") {
      return Object.freeze({ outcome: "self_approval_blocked" });
    }
    if (approveResult.code === "42501") return Object.freeze({ outcome: "unauthorized" });
    if (approveResult.code === "55000") return Object.freeze({ outcome: "not_approvable" });
    return Object.freeze({ outcome: "service_unavailable" });
  }

  if (decision === "approve") {
    // Serviço só é resolvido aqui, nunca antes: negar uma solicitação nunca
    // deveria poder falhar por causa de uma chave de service-role mal
    // configurada, já que `deny` nunca precisa dela.
    const serviceClient = dependencies.serviceClient ?? createServiceRoleClientSafely();
    if (serviceClient !== null) {
      // Tolera de propósito o precondition-not-met ("ainda falta a segunda
      // aprovação"): não é uma falha desta chamada, é o estado normal antes
      // do quorum completar. `data.state` já reflete a verdade atual mesmo
      // quando este passo não avança nada.
      await callRpc(serviceClient, "portal_authorize_data_governance_request_service", {
        p_tenant_id: beforeStatus.status.tenantId, p_request_id: requestId,
      });
    }
  }

  const afterStatus = await fetchStatus(authenticatedClient, requestId);
  if ("errorOutcome" in afterStatus) return Object.freeze({ outcome: afterStatus.errorOutcome });
  return Object.freeze({ outcome: "recorded", status: afterStatus.status });
}

export async function cancelTenantDataGovernanceDisposition(
  requestId: string,
  dependencies: DataGovernanceDispositionDependencies = {},
): Promise<CancelDataGovernanceDispositionResult> {
  if (!UUID_V7_PATTERN.test(requestId)) return Object.freeze({ outcome: "unauthorized" });
  const authenticatedClient = dependencies.authenticatedClient ?? (await createClient());
  const idGenerator = dependencies.idGenerator ?? createUuidV7;

  const receiptId = idGenerator();
  const cancelResult = await callRpc(authenticatedClient, "portal_cancel_data_governance_request_authenticated", {
    p_request_id: requestId, p_receipt_id: receiptId,
  });
  if (!cancelResult.ok) {
    if (cancelResult.code === "42501") return Object.freeze({ outcome: "unauthorized" });
    if (cancelResult.code === "55000") return Object.freeze({ outcome: "not_cancellable" });
    return Object.freeze({ outcome: "service_unavailable" });
  }
  return Object.freeze({ outcome: "cancelled" });
}

function createServiceRoleClientSafely(): RpcClient | null {
  try {
    return createServiceRoleClient();
  } catch (error) {
    if (error instanceof ServiceRoleUnavailableError) return null;
    throw error;
  }
}

const SETTINGS_PATH = "/configuracoes";

/**
 * Adaptadores `<form action={...}>` pra `/configuracoes` (mesmo padrão de
 * `calendar-connection.ts`: nunca devolvem valor, sempre redirecionam com
 * `governance_status`/`governance_error` na query, e revalidam a página pra
 * ela reler o estado fresco no próximo render). A lógica testável de verdade
 * é a das funções acima -- estas três só traduzem FormData/outcome pro
 * idioma de navegação que o resto da tela de Configurações já usa.
 */
export async function submitTenantDataGovernanceDispositionRequest(formData: FormData): Promise<void> {
  const purposeCode = formData.get("purposeCode");
  if (!isTenantDispositionPurposeCode(purposeCode)) redirect(`${SETTINGS_PATH}?governance_error=motivo_invalido`);
  const result = await requestTenantDataGovernanceDisposition(purposeCode);
  revalidatePath(SETTINGS_PATH);
  if (result.outcome === "requested") redirect(`${SETTINGS_PATH}?governance_status=solicitado`);
  if (result.outcome === "not_ready") redirect(`${SETTINGS_PATH}?governance_error=nao_disponivel`);
  if (result.outcome === "active_request_exists") redirect(`${SETTINGS_PATH}?governance_error=pedido_ja_existe`);
  if (result.outcome === "tenant_not_admissible") redirect(`${SETTINGS_PATH}?governance_error=tenant_nao_admite`);
  if (result.outcome === "unauthorized") redirect(`${SETTINGS_PATH}?governance_error=apenas_admin`);
  redirect(`${SETTINGS_PATH}?governance_error=falha_ao_solicitar`);
}

async function submitApprovalDecision(formData: FormData, decision: "approve" | "deny"): Promise<void> {
  const requestId = formData.get("requestId");
  if (typeof requestId !== "string") redirect(`${SETTINGS_PATH}?governance_error=falha_ao_aprovar`);
  const result = await approveTenantDataGovernanceDisposition(requestId, decision);
  revalidatePath(SETTINGS_PATH);
  if (result.outcome === "recorded") redirect(`${SETTINGS_PATH}?governance_status=registrado`);
  if (result.outcome === "not_approvable") redirect(`${SETTINGS_PATH}?governance_error=nao_aprovavel`);
  if (result.outcome === "self_approval_blocked") redirect(`${SETTINGS_PATH}?governance_error=autoaprovacao_bloqueada`);
  if (result.outcome === "unauthorized") redirect(`${SETTINGS_PATH}?governance_error=apenas_admin`);
  redirect(`${SETTINGS_PATH}?governance_error=falha_ao_aprovar`);
}

export async function approveTenantDataGovernanceDispositionRequest(formData: FormData): Promise<void> {
  await submitApprovalDecision(formData, "approve");
}

export async function denyTenantDataGovernanceDispositionRequest(formData: FormData): Promise<void> {
  await submitApprovalDecision(formData, "deny");
}

export async function cancelTenantDataGovernanceDispositionRequest(formData: FormData): Promise<void> {
  const requestId = formData.get("requestId");
  if (typeof requestId !== "string") redirect(`${SETTINGS_PATH}?governance_error=falha_ao_cancelar`);
  const result = await cancelTenantDataGovernanceDisposition(requestId);
  revalidatePath(SETTINGS_PATH);
  if (result.outcome === "cancelled") redirect(`${SETTINGS_PATH}?governance_status=cancelado`);
  if (result.outcome === "not_cancellable") redirect(`${SETTINGS_PATH}?governance_error=nao_cancelavel`);
  if (result.outcome === "unauthorized") redirect(`${SETTINGS_PATH}?governance_error=apenas_admin`);
  redirect(`${SETTINGS_PATH}?governance_error=falha_ao_cancelar`);
}
