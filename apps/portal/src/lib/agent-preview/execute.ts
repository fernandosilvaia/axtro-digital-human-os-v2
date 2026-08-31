import { UUID_V7_PATTERN } from "@axtro/domain";
import type {
  PortalTextPreviewActionResult,
  PortalTextPreviewBrowserCommand,
} from "@axtro/contracts-ts";

import type {
  AdmitPortalTextPreviewInput,
  PortalTextPreviewAdmission,
  PortalTextPreviewEgressGrant,
  PortalTextPreviewPersistence,
  PortalTextPreviewTurnAcquisition,
  PortalTextPreviewTurnGrant,
} from "../runtime/portal-text-preview-runtime.ts";
import type { TextPreviewStatePayload, TextPreviewStateTurn } from "./state-token.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STATE_SECRET_PATTERN = /^[0-9a-f]{64}$/;
const COMMAND_KEYS = Object.freeze([
  "schema_version",
  "agentId",
  "clientConversationId",
  "commandId",
  "userMessage",
  "stateToken",
  "aiIdentityAcknowledged",
  "essentialProcessingAccepted",
  "persistentTranscript",
] as const);
const MAX_TURN_CHARS = 2000;
const MAX_ASSISTANT_REPLY_CHARS = 4000;
const MAX_BROWSER_ERROR_CHARS = 1000;
const MIN_STATE_TOKEN_CHARS = 51;
const MAX_STATE_TOKEN_CHARS = 96 * 1024;
const STATE_TOKEN_PATTERN = /^ptsv1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const PROVIDER_REQUEST_ID_PATTERN = /^[!-~]{1,128}$/;

export type AgentPreviewCommand = Readonly<PortalTextPreviewBrowserCommand>;

export interface AgentPreviewContext {
  readonly userId: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly agent: Readonly<{
    id: string;
    name: string;
  }>;
}

export type AgentPreviewGenerationResult =
  | Readonly<{
    outcome: "success";
    reply: string;
    error: null;
    providerRequestId: string;
  }>
  | Readonly<{
    outcome: "failure";
    reply: null;
    error: string;
    reason: "generation_failed";
    providerRequestId: null;
  }>
  | Readonly<{
    outcome: "failure";
    reply: null;
    error: string;
    reason: "provider_response_uncommitted";
    providerRequestId: string;
  }>;

export type AgentPreviewResult = Readonly<PortalTextPreviewActionResult>;

export interface AgentPreviewExecutionDependencies {
  readonly resolveContext: (agentId: string) => Promise<AgentPreviewContext | null>;
  readonly stateSecret: () => string;
  readonly preverifyStateToken: (token: string, stateSecret: string) => void;
  readonly admit: (
    input: Readonly<AdmitPortalTextPreviewInput & { persistentTranscript: false }>,
  ) => Promise<PortalTextPreviewAdmission>;
  readonly stateForAdmission: (
    admission: PortalTextPreviewAdmission,
    authenticatedUserId: string,
    token: string | null,
    stateSecret: string,
  ) => TextPreviewStatePayload;
  readonly preflightNextStateCapacity: (
    admission: PortalTextPreviewAdmission,
    state: TextPreviewStatePayload,
    userMessage: string,
    stateSecret: string,
  ) => void;
  readonly acquireTurn: (input: Readonly<{
    admission: PortalTextPreviewAdmission;
    state: TextPreviewStatePayload;
    commandId: string;
    userMessage: string;
    stateSecret: string;
  }>) => Promise<PortalTextPreviewTurnAcquisition>;
  readonly assertTurnGrantCurrent: (grant: PortalTextPreviewTurnGrant) => void;
  readonly authorizeGenerationEgress: (
    grant: PortalTextPreviewTurnGrant,
  ) => Promise<PortalTextPreviewEgressGrant>;
  readonly assertGenerationEgressGrantCurrent: (
    grant: PortalTextPreviewTurnGrant,
    egressGrant: PortalTextPreviewEgressGrant,
  ) => void;
  readonly generate: (input: Readonly<{
    context: AgentPreviewContext;
    admission: PortalTextPreviewAdmission;
    grant: PortalTextPreviewTurnGrant;
    egressGrant: PortalTextPreviewEgressGrant;
    history: readonly TextPreviewStateTurn[];
    userMessage: string;
  }>) => Promise<AgentPreviewGenerationResult>;
  readonly issueNextState: (
    admission: PortalTextPreviewAdmission,
    state: TextPreviewStatePayload,
    userMessage: string,
    assistantReply: string,
    stateSecret: string,
  ) => string;
  readonly completeTurn: (
    admission: PortalTextPreviewAdmission,
    grant: PortalTextPreviewTurnGrant,
    userMessage: string,
    assistantReply: string,
    providerRequestId: string | null,
    stateSecret: string,
  ) => Promise<PortalTextPreviewPersistence>;
  readonly failTurn: (
    grant: PortalTextPreviewTurnGrant,
    reasonCode: string,
    providerRequestId: string | null,
  ) => Promise<boolean>;
  readonly reconcileProviderResponse: (
    grant: PortalTextPreviewTurnGrant,
    providerRequestId: string,
  ) => Promise<"succeeded" | "failed">;
}

function ownDataRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of ownKeys) {
      const descriptor = descriptors[String(key)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    }
    return value as Readonly<Record<string, unknown>>;
  } catch {
    return null;
  }
}

function isStateToken(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= MIN_STATE_TOKEN_CHARS
    && value.length <= MAX_STATE_TOKEN_CHARS
    && STATE_TOKEN_PATTERN.test(value);
}

function parseCommand(value: unknown): AgentPreviewCommand | null {
  const record = ownDataRecord(value);
  if (!record) return null;
  const keys = Reflect.ownKeys(record);
  if (keys.length !== COMMAND_KEYS.length
    || !COMMAND_KEYS.every((key) => Object.hasOwn(record, key))) return null;
  if (record.schema_version !== "2.0.0"
    || typeof record.agentId !== "string"
    || !UUID_V7_PATTERN.test(record.agentId)
    || typeof record.clientConversationId !== "string"
    || !UUID_PATTERN.test(record.clientConversationId)
    || typeof record.commandId !== "string"
    || !UUID_PATTERN.test(record.commandId)
    || typeof record.userMessage !== "string"
    || record.userMessage.length < 1
    || record.userMessage.length > MAX_TURN_CHARS
    || !/\S/.test(record.userMessage)
    || (record.stateToken !== null && !isStateToken(record.stateToken))
    || record.aiIdentityAcknowledged !== true
    || record.essentialProcessingAccepted !== true
    // M6-02 restores the core but cannot authorize content retention before M6-04.
    || record.persistentTranscript !== false) return null;
  return Object.freeze({
    schema_version: "2.0.0",
    agentId: record.agentId,
    clientConversationId: record.clientConversationId,
    commandId: record.commandId,
    userMessage: record.userMessage.trim(),
    stateToken: record.stateToken,
    aiIdentityAcknowledged: true,
    essentialProcessingAccepted: true,
    persistentTranscript: false,
  });
}

function browserFailureMessage(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= MAX_BROWSER_ERROR_CHARS
    ? normalized
    : fallback;
}

function result(
  reply: string | null,
  error: string | null,
  stateToken: string | null = null,
  persistence: PortalTextPreviewPersistence = "disabled",
): AgentPreviewResult {
  if (reply !== null && error === null && stateToken !== null) {
    return Object.freeze({
      schema_version: "2.0.0",
      outcome: "success",
      reply,
      error: null,
      stateToken,
      persistence,
    });
  }
  return Object.freeze({
    schema_version: "2.0.0",
    outcome: "failure",
    reply: null,
    error: browserFailureMessage(error, "Não foi possível concluir esta solicitação."),
    stateToken: null,
    persistence: persistence === "saved" ? "not_saved" : persistence,
  });
}

function acquisitionMessage(
  acquisition: Exclude<PortalTextPreviewTurnAcquisition, { acquired: true }>,
): string {
  switch (acquisition.reason) {
    case "admission_expired":
      return "Esta conversa expirou. Recarregue a página para iniciar um novo teste.";
    case "turn_in_flight":
      return "Esta mensagem já está sendo processada. Aguarde antes de tentar novamente.";
    case "turn_already_processed":
      return "Esta mensagem já foi concluída, mas a resposta anterior não pode ser recuperada sem persistir seu conteúdo. Inicie uma nova conversa.";
    case "stale_generation":
    case "turn_replay_conflict":
    case "admission_mismatch":
      return "O estado da conversa não é mais válido. Recarregue a página para continuar com segurança.";
    case "invalid_request":
      return "Esta conversa atingiu o limite seguro. Recarregue a página para iniciar um novo teste.";
    default:
      return "Não foi possível autorizar este turno agora. Tente novamente.";
  }
}

function isProviderRequestId(value: unknown): value is string {
  return typeof value === "string" && PROVIDER_REQUEST_ID_PATTERN.test(value);
}

async function failAcquiredTurn(
  dependencies: AgentPreviewExecutionDependencies,
  grant: PortalTextPreviewTurnGrant,
  reasonCode: string,
  providerRequestId: string | null,
): Promise<void> {
  let failed = false;
  try {
    failed = await dependencies.failTurn(grant, reasonCode, providerRequestId);
  } catch {
    // The browser response is already blocked. Do not create a second provider effect.
  }
  if (!failed
    && reasonCode === "provider_response_uncommitted"
    && providerRequestId !== null) {
    try {
      await dependencies.reconcileProviderResponse(grant, providerRequestId);
    } catch {
      // Reconciliation is the only allowed follow-up for an ambiguous provider response.
    }
  }
}

export async function executeAgentPreviewCommand(
  rawCommand: unknown,
  dependencies: AgentPreviewExecutionDependencies,
): Promise<AgentPreviewResult> {
  const command = parseCommand(rawCommand);
  if (command === null) {
    return result(null, `A solicitação é inválida. A mensagem precisa ter entre 1 e ${MAX_TURN_CHARS} caracteres e a transcrição permanece desativada.`);
  }

  let stateSecret: string;
  try {
    stateSecret = dependencies.stateSecret();
  } catch {
    return result(null, "O estado seguro do chat ainda não está configurado neste ambiente.");
  }
  if (!STATE_SECRET_PATTERN.test(stateSecret)) {
    return result(null, "O estado seguro do chat ainda não está configurado neste ambiente.");
  }
  if (command.stateToken !== null) {
    try {
      dependencies.preverifyStateToken(command.stateToken, stateSecret);
    } catch {
      return result(null, "O estado da conversa é inválido ou expirou. Recarregue a página para iniciar um novo teste.");
    }
  }

  let context: AgentPreviewContext | null;
  try {
    context = await dependencies.resolveContext(command.agentId);
  } catch {
    return result(null, "Não foi possível validar sua conta agora.");
  }
  if (context === null || context.agent.id !== command.agentId) {
    return result(null, "Agente não encontrado nesta conta.");
  }

  let admission: PortalTextPreviewAdmission;
  try {
    admission = await dependencies.admit({
      authenticatedUserId: context.userId,
      expectedTenantId: context.tenantId,
      agentId: context.agent.id,
      clientConversationId: command.clientConversationId,
      aiIdentityAcknowledged: command.aiIdentityAcknowledged,
      essentialProcessingAccepted: command.essentialProcessingAccepted,
      persistentTranscript: false,
      expectExisting: command.stateToken !== null,
    });
  } catch {
    return result(null, "Não foi possível registrar o disclosure e o processamento essencial. Nenhuma resposta foi gerada.");
  }
  if (admission.tenant_id !== context.tenantId
    || admission.agent_id !== context.agent.id
    || admission.persistent_transcript !== false
    || admission.transcript_consent_id !== null
    || admission.transcript_id !== null
    || admission.status !== "issued") {
    return result(null, "A admissão segura desta conversa não pôde ser confirmada. Nenhuma resposta foi gerada.");
  }

  let state: TextPreviewStatePayload;
  try {
    state = dependencies.stateForAdmission(
      admission,
      context.userId,
      command.stateToken,
      stateSecret,
    );
  } catch {
    return result(null, "O estado da conversa é inválido ou expirou. Recarregue a página para iniciar um novo teste.");
  }

  try {
    dependencies.preflightNextStateCapacity(admission, state, command.userMessage, stateSecret);
  } catch {
    return result(null, "Esta conversa atingiu o limite seguro de estado. Recarregue a página para iniciar um novo teste.");
  }

  let acquisition: PortalTextPreviewTurnAcquisition;
  try {
    acquisition = await dependencies.acquireTurn({
      admission,
      state,
      commandId: command.commandId,
      userMessage: command.userMessage,
      stateSecret,
    });
  } catch {
    return result(null, "Não foi possível autorizar este turno agora. Tente novamente.");
  }
  if (!acquisition.acquired) return result(null, acquisitionMessage(acquisition));

  try {
    dependencies.assertTurnGrantCurrent(acquisition.grant);
  } catch {
    await failAcquiredTurn(dependencies, acquisition.grant, "generation_failed", null);
    return result(null, "O tempo seguro deste turno expirou antes da geração. Tente novamente.");
  }

  let generationEgress: PortalTextPreviewEgressGrant;
  try {
    generationEgress = await dependencies.authorizeGenerationEgress(acquisition.grant);
    if (generationEgress.kind !== "generation"
      || generationEgress.admissionId !== acquisition.grant.admissionId
      || generationEgress.claimId !== acquisition.grant.claimId
      || generationEgress.attemptId !== acquisition.grant.attemptId
      || generationEgress.generation !== acquisition.grant.generation) {
      throw new Error("generation egress binding mismatch");
    }
    dependencies.assertGenerationEgressGrantCurrent(acquisition.grant, generationEgress);
  } catch {
    await failAcquiredTurn(dependencies, acquisition.grant, "generation_failed", null);
    return result(null, "Não foi possível autorizar a saída para o provider. Nenhuma resposta foi gerada.");
  }

  let generated: AgentPreviewGenerationResult;
  try {
    generated = await dependencies.generate({
      context,
      admission,
      grant: acquisition.grant,
      egressGrant: generationEgress,
      history: state.turns,
      userMessage: command.userMessage,
    });
  } catch {
    await failAcquiredTurn(dependencies, acquisition.grant, "generation_failed", null);
    return result(null, "Erro inesperado ao falar com o agente.");
  }
  if (generated.outcome === "failure") {
    const providerRequestId = generated.reason === "provider_response_uncommitted"
      && isProviderRequestId(generated.providerRequestId)
      ? generated.providerRequestId
      : null;
    const reason = providerRequestId === null ? "generation_failed" : generated.reason;
    await failAcquiredTurn(dependencies, acquisition.grant, reason, providerRequestId);
    return result(
      null,
      reason === "provider_response_uncommitted"
        ? "A resposta do provider não pôde ser confirmada. Tente novamente."
        : "Não foi possível gerar uma resposta agora. Tente novamente.",
    );
  }
  if (!isProviderRequestId(generated.providerRequestId)) {
    await failAcquiredTurn(dependencies, acquisition.grant, "generation_failed", null);
    return result(null, "A resposta do provider não pôde ser vinculada ao turno com segurança.");
  }
  const providerRequestId = generated.providerRequestId;
  if (typeof generated.reply !== "string"
    || generated.reply.trim().length < 1
    || generated.reply.length > MAX_ASSISTANT_REPLY_CHARS) {
    const reason = providerRequestId === null
      ? "generated_reply_invalid"
      : "provider_response_uncommitted";
    await failAcquiredTurn(dependencies, acquisition.grant, reason, providerRequestId);
    return result(null, "A resposta gerada excedeu o limite seguro. Tente novamente.");
  }

  let nextStateToken: string;
  try {
    nextStateToken = dependencies.issueNextState(
      admission,
      state,
      command.userMessage,
      generated.reply,
      stateSecret,
    );
    if (!isStateToken(nextStateToken)) throw new Error("invalid state token");
  } catch {
    const reason = providerRequestId === null
      ? "state_issue_failed"
      : "provider_response_uncommitted";
    await failAcquiredTurn(dependencies, acquisition.grant, reason, providerRequestId);
    return result(null, "O estado seguro da conversa não pôde ser emitido. Nenhuma resposta foi concluída.");
  }

  let persistence: PortalTextPreviewPersistence;
  try {
    persistence = await dependencies.completeTurn(
      admission,
      acquisition.grant,
      command.userMessage,
      generated.reply,
      providerRequestId,
      stateSecret,
    );
  } catch {
    if (providerRequestId !== null) {
      try {
        await dependencies.reconcileProviderResponse(acquisition.grant, providerRequestId);
      } catch {
        // An ambiguous completion remains a failure even when reconciliation is unavailable.
      }
    }
    return result(null, "A resposta foi gerada, mas a conclusão atômica do turno não pôde ser confirmada. Inicie uma nova conversa.");
  }
  if (persistence !== "disabled") {
    return result(null, "A conclusão do turno violou a política de retenção desativada. Inicie uma nova conversa.");
  }
  return result(generated.reply, null, nextStateToken, "disabled");
}
