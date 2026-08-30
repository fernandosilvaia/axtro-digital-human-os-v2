"use server";

/**
 * ADR-041, "O funil ponta a ponta de uma tool call de negócio". Server
 * Action nova que o dispatcher cliente (tool-call-dispatcher.ts) chama para
 * as tools next_slide/previous_slide/go_to_slide -- não, para
 * register_lead/propose_meeting_slots/confirm_meeting_slot; cena continua
 * fora deste arquivo, tratada localmente pelos componentes (ADR-038, fora
 * do escopo desta ADR).
 *
 * Passo a passo (numeração da própria ADR-041):
 *   1. Resolve tenantId via fetchTenantOverview()/fetchAgents(), confirma
 *      que agentId pertence ao tenant autenticado -- nunca aceita tenantId
 *      do chamador, mesmo padrão de startVideoConversation.
 *   2. Resolve o contexto da chamada viva (sessionId/presenterId/generation)
 *      via resolveLiveBusinessActionCallContext, a partir da MESMA chave de
 *      idempotência que start/stopVideoConversation já usam
 *      (paidEffectIntentKey(commandId, "tavus:video"|"tavus:presentation")).
 *   3. Valida toolName contra BUSINESS_ACTION_TOOL_NAMES -- defensivo, o
 *      dispatcher cliente já filtrou antes de chamar esta Server Action.
 *   4. Faz parse de rawArguments e valida contra o schema fechado da tool
 *      (os 3 JSON Schemas da ADR-041, "Contrato das tools") -- validação
 *      manual campo a campo, sem lib de JSON Schema nova.
 *   5. Deriva um commandId de admissão determinístico a partir do
 *      tool_call_id do Tavus (deterministicBusinessActionCommandId) e
 *      chama admitBusinessAction.
 *   6. Se o grant for issued/replayed, despacha para a RPC de negócio
 *      correspondente ao actionKind.
 *   7. Traduz o outcome (tabela "Texto de resposta ao modelo por categoria
 *      de outcome" da ADR-041, textos copiados literalmente) e devolve.
 *   8. Tudo roda sob um timeout interno de 8s -- um timeout nunca deixa a
 *      tool call sem tool_result (Art. 14): sempre volta a categoria
 *      "Handoff".
 *
 * LIMITAÇÕES CONHECIDAS DESTA ONDA (documentadas aqui de propósito, ver
 * também o handoff/relatório da onda):
 *
 * - propose_meeting_slots nunca chama proposeBusinessMeetingSlots nesta
 *   onda. A ADR-041 pede uma consulta real de FreeBusy ao Google
 *   (computeGoogleCalendarAvailableSlots) antes de ter o que persistir; essa
 *   peça não existe neste worktree hoje (confirmado por busca: não há
 *   apps/portal/src/lib/google-calendar/availability.ts nem qualquer
 *   computeGoogleCalendarAvailableSlots em packages/provider-google-calendar
 *   ou em apps/portal). Inventar uma lista de horários sem disponibilidade
 *   real seria pior que recusar: um horário "livre" fabricado que na
 *   verdade está ocupado quebra a promessa de nunca inventar dado (Art. 3).
 *   Por isso esta tool sempre devolve a categoria Handoff aqui, sem tocar a
 *   RPC de persistência -- mesma decisão que a própria ADR-041 já autoriza
 *   explicitamente para esta onda.
 *
 * - confirm_meeting_slot também nunca chama reserveBusinessMeetingSlot
 *   nesta onda, por um motivo DIFERENTE, descoberto durante a implementação
 *   (não estava documentado na ADR): o JSON Schema de confirm_meeting_slot
 *   ("Contrato das tools") pede ao modelo um slotIndex (inteiro, a posição
 *   0-based do horário que ele leu em voz alta), mas
 *   portal_reserve_business_meeting_slot_service (0052) exige p_slot_id (um
 *   app.uuid_v7 -- a chave real da linha em
 *   portal_business_action_proposal_slots). Não existe hoje nenhuma RPC de
 *   leitura que resolva (tenantId, proposalId, slotIndex) -> slot_id; a
 *   0052 não expõe portal_business_action_proposal_slots para leitura
 *   alguma (revoke all ... from public,anon,authenticated,service_role,
 *   igual a toda outra tabela deste domínio -- só uma função security
 *   definer consegue ler). Como propose_meeting_slots também nunca persiste
 *   uma proposta real nesta onda (limitação acima), essa tradução seria
 *   sempre inalcançável de qualquer forma: não existe proposta real para
 *   resolver o índice contra. Adicionar a RPC de leitura que falta é uma
 *   migration nova -- fora do escopo desta onda ("nenhuma migration nova
 *   nesta onda"). reserveBusinessMeetingSlot em portal-business-action-bridge.ts
 *   está implementado e testado isoladamente (com slotId já resolvido),
 *   pronto para ser ligado aqui assim que essa RPC de leitura existir.
 */

import { paidEffectIntentKey } from "@/lib/paid-effects";
import { fetchAgents, fetchTenantOverview } from "@/lib/portal-data";
import { deterministicBusinessActionCommandId } from "@/lib/runtime/business-action-command-id";
import {
  admitBusinessAction,
  registerBusinessLead,
  type PortalBusinessActionKind,
  type PortalBusinessActionRejectionCode,
} from "@/lib/runtime/portal-business-action-bridge";
import { isBusinessActionToolName } from "@/lib/runtime/tool-call-names";
import { resolveLiveBusinessActionCallContext } from "@/lib/runtime/portal-live-call-context";

export interface BusinessActionToolCallResult {
  readonly status: "success" | "error";
  readonly output: string;
}

/**
 * Injeção de dependência opcional, mesmo padrão que
 * portal-business-action-bridge.ts (PortalBusinessActionBridgeDependencies)
 * e portal-live-call-context.ts (ResolveLiveBusinessActionCallContextDependencies)
 * já usam: em produção, cada campo assume o import real (Server Action de
 * verdade, sessão HTTP real); em teste, um chamador injeta fakes e nunca
 * toca rede/Supabase. timeoutMs existe só para o teste de timeout não
 * precisar esperar 8s de verdade.
 */
export interface BusinessActionToolCallDependencies {
  readonly fetchTenantOverview?: typeof fetchTenantOverview;
  readonly fetchAgents?: typeof fetchAgents;
  readonly resolveLiveBusinessActionCallContext?: typeof resolveLiveBusinessActionCallContext;
  readonly admitBusinessAction?: typeof admitBusinessAction;
  readonly registerBusinessLead?: typeof registerBusinessLead;
  readonly timeoutMs?: number;
}

const INTERNAL_TIMEOUT_MS = 8_000;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** RFC 5321 sec. 4.5.3.1.3 total-length bound -- same constant already used by lib/google-calendar/id-token.ts. Achado real de revisão adversarial: contactEmail era o único campo de contato sem limite de tamanho em nenhuma das camadas do funil (contactName/contactPhone/qualificationSummary já tinham bound). */
const MAX_EMAIL_CHARS = 320;
const MEETING_DURATIONS_MINUTES = new Set([15, 30, 45, 60]);
const RETRYABLE_REJECTION_CODES: ReadonlySet<PortalBusinessActionRejectionCode> = new Set(["slot_not_offered", "proposal_expired", "slot_conflict"]);

/** Textos da tabela "Texto de resposta ao modelo por categoria de outcome" (ADR-041), copiados literalmente. */
const OUTCOME_TEXT = Object.freeze({
  registerLeadSuccess: "Lead registrado.",
  retryable: "Esse horário não está mais disponível. Ofereça consultar novos horários com propose_meeting_slots.",
  handoff: "Ação indisponível agora. Ofereça transferir para o time humano, com a doutrina de handoff já definida.",
  sessionNotFound: "Sessão desta chamada não está pronta para esta ação. Não repita a tentativa; ofereça o handoff.",
});

function successResult(output: string): BusinessActionToolCallResult {
  return Object.freeze({ status: "success", output });
}

function declaredOutcome(category: "retryable" | "handoff" | "session_not_found"): BusinessActionToolCallResult {
  if (category === "retryable") return Object.freeze({ status: "error", output: OUTCOME_TEXT.retryable });
  if (category === "session_not_found") return Object.freeze({ status: "error", output: OUTCOME_TEXT.sessionNotFound });
  return Object.freeze({ status: "error", output: OUTCOME_TEXT.handoff });
}

/** Every declared rejection reason not explicitly "retomável" in the ADR-041 table defaults to Handoff -- the safe bucket. */
function categorizeRejection(code: PortalBusinessActionRejectionCode): "retryable" | "handoff" {
  return RETRYABLE_REJECTION_CODES.has(code) ? "retryable" : "handoff";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function parseRawArguments(rawArguments: string | Record<string, unknown>): Record<string, unknown> | null {
  if (typeof rawArguments === "string") {
    try {
      const parsed: unknown = JSON.parse(rawArguments);
      return isPlainObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isPlainObject(rawArguments) ? rawArguments : null;
}

interface RegisterLeadArgs {
  readonly contactName: string;
  readonly contactEmail?: string;
  readonly contactPhone?: string;
  readonly qualificationSummary?: string;
}

/**
 * Manual, field-by-field validation against the register_lead JSON Schema
 * ("Contrato das tools", ADR-041) -- same explicit style
 * portal-business-action-bridge.ts already uses, no schema-validator
 * dependency. The schema itself only requires contactName; the extra
 * "contactEmail or contactPhone" rule mirrors registerBusinessLead's own
 * business rule, checked HERE (not left to throw inside the wrapper) so a
 * model call missing both is a normal, testable "argumento fora do schema"
 * outcome instead of an internal exception.
 */
function validateRegisterLeadArgs(value: Record<string, unknown>): RegisterLeadArgs | null {
  const contactName = value.contactName;
  if (typeof contactName !== "string" || contactName.trim().length < 1 || contactName.length > 200) return null;
  const contactEmail = value.contactEmail;
  if (contactEmail !== undefined && (typeof contactEmail !== "string" || contactEmail.length > MAX_EMAIL_CHARS || !EMAIL_PATTERN.test(contactEmail))) return null;
  const contactPhone = value.contactPhone;
  if (contactPhone !== undefined && (typeof contactPhone !== "string" || contactPhone.length === 0 || contactPhone.length > 32)) return null;
  if (contactEmail === undefined && contactPhone === undefined) return null;
  const qualificationSummary = value.qualificationSummary;
  if (qualificationSummary !== undefined && (typeof qualificationSummary !== "string" || qualificationSummary.length > 2_000)) return null;
  return Object.freeze({
    contactName,
    ...(typeof contactEmail === "string" ? { contactEmail } : {}),
    ...(typeof contactPhone === "string" ? { contactPhone } : {}),
    ...(typeof qualificationSummary === "string" ? { qualificationSummary } : {}),
  });
}

interface ProposeMeetingSlotsArgs {
  readonly durationMinutes: 15 | 30 | 45 | 60;
  readonly contactName?: string;
  readonly contactEmail?: string;
}

function validateProposeMeetingSlotsArgs(value: Record<string, unknown>): ProposeMeetingSlotsArgs | null {
  const durationMinutes = value.durationMinutes;
  if (typeof durationMinutes !== "number" || !Number.isInteger(durationMinutes) || !MEETING_DURATIONS_MINUTES.has(durationMinutes)) return null;
  const contactName = value.contactName;
  if (contactName !== undefined && (typeof contactName !== "string" || contactName.length > 200)) return null;
  const contactEmail = value.contactEmail;
  if (contactEmail !== undefined && (typeof contactEmail !== "string" || !EMAIL_PATTERN.test(contactEmail))) return null;
  return Object.freeze({
    durationMinutes: durationMinutes as 15 | 30 | 45 | 60,
    ...(typeof contactName === "string" ? { contactName } : {}),
    ...(typeof contactEmail === "string" ? { contactEmail } : {}),
  });
}

interface ConfirmMeetingSlotArgs {
  readonly proposalId: string;
  readonly slotIndex: number;
  readonly contactEmail: string;
}

function validateConfirmMeetingSlotArgs(value: Record<string, unknown>): ConfirmMeetingSlotArgs | null {
  const proposalId = value.proposalId;
  if (typeof proposalId !== "string" || proposalId.length === 0) return null;
  const slotIndex = value.slotIndex;
  if (typeof slotIndex !== "number" || !Number.isInteger(slotIndex) || slotIndex < 0) return null;
  const contactEmail = value.contactEmail;
  if (typeof contactEmail !== "string" || contactEmail.length > MAX_EMAIL_CHARS || !EMAIL_PATTERN.test(contactEmail)) return null;
  return Object.freeze({ proposalId, slotIndex, contactEmail });
}

/**
 * Achado real de revisão de segurança adversarial (ADR-041 onda B): `Promise.race`
 * entre o trabalho real e o timeout de 8s NUNCA cancela a promise perdedora --
 * quando o timeout vence, `runBusinessActionToolCall` continua rodando no
 * servidor até o fim, inclusive escrevendo no banco (`admitBusinessAction`/
 * `registerBusinessLead`), MESMO DEPOIS de a Server Action já ter devolvido
 * "Handoff" ao Tavus. Se o modelo, ouvindo esse "Handoff", decidir tentar de
 * novo com um `tool_call_id` GENUINAMENTE NOVO (o comportamento que a própria
 * ADR-041, linha 113, já define como correto -- "uma nova decisão do modelo"
 * merece um grant novo), a tentativa nova deriva um `commandId`/
 * `commandFingerprint` diferente da original e é admitida como uma intenção
 * legitimamente nova -- enquanto a tentativa original, nunca cancelada,
 * eventualmente completa e grava SUA PRÓPRIA linha também. Resultado: dois
 * leads para o mesmo contato na mesma sessão, exatamente a duplicação de PII
 * que o design de `commandId` determinístico existe para eliminar (linha 216
 * da ADR).
 *
 * Fix: um lock em memória de processo por `(tenantId, sessionId, actionKind)`
 * -- mesmo mecanismo e mesma ressalva operacional já documentada e aceita em
 * `oauth-state.ts`/`rate-limit.ts` (processo único no Railway hoje). Uma
 * segunda chamada para o MESMO (tenant, sessão, ação) que chega enquanto a
 * primeira ainda está em voo nunca inicia uma segunda admissão: ela espera o
 * resultado da tentativa já em andamento e devolve o mesmo resultado, mesmo
 * que isso signifique que ela também estoure o próprio timeout de 8s
 * aguardando (nesse caso o chamador recebe Handoff de qualquer forma, mas
 * NENHUMA escrita duplicada acontece). Isto é deliberadamente mais estreito
 * que cancelar a tentativa original (o que exigiria propagar AbortSignal por
 * cinco camadas até a chamada RPC do Supabase): fecha exatamente a janela de
 * corrida que o achado descreve, sem impedir uma reconvocação sequencial
 * genuína depois que a primeira tentativa já terminou (o comportamento que a
 * ADR-041 linha 113 já define como correto continua funcionando).
 */
const inFlightBusinessActions = new Map<string, Promise<BusinessActionToolCallResult>>();

function inFlightBusinessActionKey(tenantId: string, sessionId: string, actionKind: string): string {
  return `${tenantId}:${sessionId}:${actionKind}`;
}

async function admitAndDispatchBusinessAction(
  tenantId: string,
  agentId: string,
  sessionId: string,
  presenterId: string,
  generation: number,
  actionKind: PortalBusinessActionKind,
  toolCallId: string,
  validatedArgs: RegisterLeadArgs | ProposeMeetingSlotsArgs | ConfirmMeetingSlotArgs,
  dependencies: Required<Omit<BusinessActionToolCallDependencies, "timeoutMs">>,
): Promise<BusinessActionToolCallResult> {
  // Passo 5: commandId de admissão determinístico a partir do tool_call_id do Tavus -- replay do mesmo tool_call_id sempre deriva o mesmo commandId.
  const admissionCommandId = deterministicBusinessActionCommandId(tenantId, agentId, sessionId, actionKind, toolCallId);
  const admission = await dependencies.admitBusinessAction({
    tenantId,
    agentId,
    sessionId,
    presenterId,
    actionKind,
    commandId: admissionCommandId,
    // admitBusinessAction canonicalizes args itself (sha256Canonical) before
    // hashing it into commandFingerprint -- no need to pre-canonicalize here.
    // validatedArgs is already a flat, frozen record of primitives; the cast
    // below only widens its structural type, it does not change its shape.
    args: validatedArgs as unknown as Readonly<Record<string, unknown>>,
    generation,
  });
  if (admission.outcome === "rejected") return declaredOutcome(categorizeRejection(admission.code));
  const { grant } = admission;

  // Passo 6: despacha para a RPC de negócio correspondente ao actionKind.
  if (actionKind === "register_lead") {
    const args = validatedArgs as RegisterLeadArgs;
    const result = await dependencies.registerBusinessLead({
      grant,
      contactName: args.contactName,
      contactEmail: args.contactEmail ?? null,
      contactPhone: args.contactPhone ?? null,
      ...(args.qualificationSummary !== undefined ? { qualificationSummary: args.qualificationSummary } : {}),
    });
    if (result.outcome === "registered") return successResult(OUTCOME_TEXT.registerLeadSuccess);
    return declaredOutcome(categorizeRejection(result.code));
  }

  // propose_meeting_slots e confirm_meeting_slot: limitações desta onda documentadas no cabeçalho do arquivo.
  // Ambas passam pela admissão (grant fica registrado, kill switch/consentimento continuam valendo), mas a RPC
  // de negócio em si não é chamada nesta onda -- por dois motivos DIFERENTES e documentados acima.
  return declaredOutcome("handoff");
}

async function runBusinessActionToolCall(
  agentId: string,
  commandId: string,
  mode: "video" | "presentation",
  toolName: string,
  toolCallId: string,
  rawArguments: string | Record<string, unknown>,
  dependencies: Required<Omit<BusinessActionToolCallDependencies, "timeoutMs">>,
): Promise<BusinessActionToolCallResult> {
  // Passo 1: tenantId sempre resolvido do lado do servidor, nunca aceito do chamador.
  const [overview, agents] = await Promise.all([dependencies.fetchTenantOverview(), dependencies.fetchAgents()]);
  if (!overview.provisioned || !overview.tenant) return declaredOutcome("handoff");
  const tenantId = overview.tenant.id;
  if (!agents.some((candidate) => candidate.id === agentId)) return declaredOutcome("handoff");

  // Passo 2: contexto da chamada viva, pela mesma chave de idempotência que start/stopVideoConversation já usam.
  const idempotencyKey = paidEffectIntentKey(commandId, mode === "video" ? "tavus:video" : "tavus:presentation");
  const liveContext = await dependencies.resolveLiveBusinessActionCallContext({ tenantId, agentId, idempotencyKey });
  if (liveContext.outcome !== "found") return declaredOutcome("session_not_found");
  const { sessionId, presenterId, generation } = liveContext.context;

  // Passo 3: defensivo -- o dispatcher cliente já só encaminha nomes de BUSINESS_ACTION_TOOL_NAMES até aqui.
  if (!isBusinessActionToolName(toolName)) return declaredOutcome("handoff");

  // Passo 4: parse + validação de schema fechado por tool. Nunca chega à RPC com argumento fora do contrato.
  const parsedArguments = parseRawArguments(rawArguments);
  if (parsedArguments === null) return declaredOutcome("handoff");

  const actionKind: PortalBusinessActionKind = toolName;
  let validatedArgs: RegisterLeadArgs | ProposeMeetingSlotsArgs | ConfirmMeetingSlotArgs | null;
  if (actionKind === "register_lead") validatedArgs = validateRegisterLeadArgs(parsedArguments);
  else if (actionKind === "propose_meeting_slots") validatedArgs = validateProposeMeetingSlotsArgs(parsedArguments);
  else validatedArgs = validateConfirmMeetingSlotArgs(parsedArguments);
  if (validatedArgs === null) return declaredOutcome("handoff");

  // Lock em voo (ver comentário acima de admitAndDispatchBusinessAction):
  // uma segunda tentativa concorrente pro mesmo (tenant, sessão, ação) nunca
  // inicia uma segunda admissão -- ela espera e reflete o resultado real da
  // tentativa já em andamento.
  const key = inFlightBusinessActionKey(tenantId, sessionId, actionKind);
  const existing = inFlightBusinessActions.get(key);
  if (existing !== undefined) return existing;

  const attempt = admitAndDispatchBusinessAction(tenantId, agentId, sessionId, presenterId, generation, actionKind, toolCallId, validatedArgs, dependencies).finally(() => {
    if (inFlightBusinessActions.get(key) === attempt) inFlightBusinessActions.delete(key);
  });
  inFlightBusinessActions.set(key, attempt);
  return attempt;
}

function timeoutOutcome(ms: number): Promise<BusinessActionToolCallResult> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(declaredOutcome("handoff")), ms);
  });
}

/**
 * Passo 8: timeout interno de 8s (proposto na ADR-041, a validar contra o
 * timeout real de tool call da Tavus). runBusinessActionToolCall nunca
 * lança para um caminho de negócio esperado (todo outcome declarado é
 * devolvido, nunca um throw); o catch abaixo é só a última rede de
 * segurança para um erro genuinamente inesperado -- garante que esta Server
 * Action SEMPRE devolve um tool_result (Art. 14), nunca deixa a tool call
 * pendurada.
 */
export async function executeBusinessActionToolCall(
  agentId: string,
  commandId: string,
  mode: "video" | "presentation",
  toolName: string,
  toolCallId: string,
  rawArguments: string | Record<string, unknown>,
  dependencies: BusinessActionToolCallDependencies = {},
): Promise<BusinessActionToolCallResult> {
  const resolved = {
    fetchTenantOverview: dependencies.fetchTenantOverview ?? fetchTenantOverview,
    fetchAgents: dependencies.fetchAgents ?? fetchAgents,
    resolveLiveBusinessActionCallContext: dependencies.resolveLiveBusinessActionCallContext ?? resolveLiveBusinessActionCallContext,
    admitBusinessAction: dependencies.admitBusinessAction ?? admitBusinessAction,
    registerBusinessLead: dependencies.registerBusinessLead ?? registerBusinessLead,
  };
  try {
    return await Promise.race([
      runBusinessActionToolCall(agentId, commandId, mode, toolName, toolCallId, rawArguments, resolved),
      timeoutOutcome(dependencies.timeoutMs ?? INTERNAL_TIMEOUT_MS),
    ]);
  } catch {
    return declaredOutcome("handoff");
  }
}
