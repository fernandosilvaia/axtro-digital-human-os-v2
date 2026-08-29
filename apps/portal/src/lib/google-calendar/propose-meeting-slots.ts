/**
 * ADR-039, onda 1b-iv: orquestração ponta a ponta de `propose_meeting_slots`
 * -- calcula disponibilidade real (`availability.ts`) e persiste a proposta
 * pela RPC `portal_propose_business_meeting_slots_service` (0052). Fronteira
 * de responsabilidade explícita, mesma que a própria RPC já assume: esta
 * função NUNCA chama `portal_admit_business_action_service` -- espera
 * receber um `grantId` já emitido por quem admitiu o `BusinessActionIntent`
 * antes (mesma fronteira de `apps/portal/src/lib/actions/leads.ts`, onda 1a,
 * que chama `admitBusinessAction` separadamente de `registerBusinessLead`).
 * `confirm_meeting_slot` (reservar/despachar/inserir evento no Google/commit)
 * é onda futura (1b-v), fora de escopo aqui -- assim como qualquer wiring
 * com a chamada de vídeo ao vivo.
 *
 * Fronteira de segurança relevante (ADR-039: "Fuso horário e janela de busca
 * [...] são resolvidos pelo SERVIDOR [...] nunca informados pelo modelo"):
 * `ProposeGoogleCalendarMeetingSlotsInput` (o shape que um chamador não
 * confiável, em última instância um `BusinessActionIntent` vindo de uma tool
 * call do modelo numa onda futura, preencheria) só aceita `durationMinutes`
 * e os campos de contato -- nunca fuso, dias úteis ou horário comercial.
 * Esses três só são ajustáveis via `dependencies` (o segundo parâmetro,
 * nunca populado a partir de input externo, só por código confiável --
 * produção usa os defaults; testes deste módulo usam isto pra manter janelas
 * pequenas e determinísticas).
 *
 * NUNCA loga o refresh token decifrado, em nenhum caminho (sucesso, erro de
 * provider, erro de RPC): o valor só existe na const local `refreshToken`
 * abaixo, usado uma única vez pra montar o port real do calendário, e nunca
 * aparece em nenhuma mensagem de erro construída por este módulo -- os erros
 * do provider real (`packages/provider-google-calendar`) já documentam a
 * mesma garantia pro `client_secret`/`refresh_token`/`code`.
 */
import { createUuidV7, UUID_V7_PATTERN } from "@axtro/domain";
import {
  createFakeGoogleCalendarPort,
  createGoogleCalendarPort,
  googleCalendarFakeProvidersEnabled,
  GoogleCalendarProviderError,
  type GoogleCalendarPort,
  type GoogleCalendarProviderErrorCode,
} from "@axtro/provider-google-calendar";

import {
  computeGoogleCalendarAvailableSlots,
  DEFAULT_MAX_PROPOSED_SLOTS,
  MEETING_DURATION_MINUTES_ALLOWLIST,
  type ProposedCalendarSlot,
} from "./availability.ts";
import type { BusinessHoursClock } from "./business-hours.ts";
import { createServiceRoleClient } from "../supabase/service.ts";

const MEETING_DURATION_MINUTES_SET: ReadonlySet<number> = new Set(MEETING_DURATION_MINUTES_ALLOWLIST);
/** Mesmo padrão pragmático (não RFC 5322 completo) já usado em `provider-google-calendar`/`portal-business-action-bridge.ts`/`id-token.ts`. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class ProposeGoogleCalendarMeetingSlotsInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposeGoogleCalendarMeetingSlotsInputError";
  }
}

export interface ProposeGoogleCalendarMeetingSlotsInput {
  readonly tenantId: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly presenterId: string;
  /** Grant já emitido por `portal_admit_business_action_service` (action_kind='propose_meeting_slots') -- esta função nunca admite, só consome. */
  readonly grantId: string;
  readonly durationMinutes: number;
  readonly contactName?: string | null;
  readonly contactEmail?: string | null;
  /** Gerado com `createUuidV7` se ausente (mesmo padrão de idempotência que o resto do domínio já usa). */
  readonly receiptId?: string;
  readonly proposalId?: string;
}

export interface GoogleCalendarRpcResult {
  readonly data: unknown;
  readonly error: { readonly message?: string } | null;
}

export interface GoogleCalendarRpcClient {
  rpc(name: string, parameters?: Readonly<Record<string, unknown>>): PromiseLike<GoogleCalendarRpcResult>;
}

export interface ProposeGoogleCalendarMeetingSlotsDependencies {
  readonly rpc?: GoogleCalendarRpcClient;
  readonly idGenerator?: () => string;
  readonly clock?: BusinessHoursClock;
  /** Bypassa a seleção real/fake por `PORTAL_FAKE_PROVIDERS` abaixo -- uso principal: testes (`createFakeGoogleCalendarPort({simulateInvalidRefreshToken:true})`, um port que lança um erro específico, etc.). */
  readonly port?: Pick<GoogleCalendarPort, "queryFreeBusy">;
  readonly maxSlots?: number;
  readonly businessDaysCount?: number;
  readonly businessStartHour?: number;
  readonly businessEndHour?: number;
}

export type ProposeGoogleCalendarMeetingSlotsResult =
  | Readonly<{ readonly outcome: "succeeded"; readonly proposalId: string; readonly receiptId: string; readonly slots: readonly ProposedCalendarSlot[] }>
  | Readonly<{ readonly outcome: "rejected"; readonly reason: string }>
  | Readonly<{ readonly outcome: "not_connected" }>
  | Readonly<{ readonly outcome: "no_availability" }>
  | Readonly<{ readonly outcome: "reauth_required" }>
  | Readonly<{ readonly outcome: "provider_error"; readonly providerErrorCode: GoogleCalendarProviderErrorCode }>
  | Readonly<{ readonly outcome: "service_unavailable" }>;

function ownRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? (value as Record<string, unknown>) : null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function assertUuidV7(value: unknown, name: string): string {
  if (typeof value !== "string" || !UUID_V7_PATTERN.test(value)) {
    throw new ProposeGoogleCalendarMeetingSlotsInputError(`${name} must be a UUIDv7`);
  }
  return value;
}

function assertDurationMinutes(value: unknown): number {
  if (typeof value !== "number" || !MEETING_DURATION_MINUTES_SET.has(value)) {
    throw new ProposeGoogleCalendarMeetingSlotsInputError(`durationMinutes must be one of ${MEETING_DURATION_MINUTES_ALLOWLIST.join(", ")}`);
  }
  return value;
}

function normalizeOptionalContactName(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 200) throw new ProposeGoogleCalendarMeetingSlotsInputError("contactName is invalid");
  return trimmed;
}

function normalizeOptionalContactEmail(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || !EMAIL_PATTERN.test(trimmed)) throw new ProposeGoogleCalendarMeetingSlotsInputError("contactEmail is invalid");
  return trimmed;
}

/** `null` cobre uniformemente falha de transporte (a promise rejeitou) e `{error: ...}` devolvido pela RPC -- os dois viram `service_unavailable` no chamador, sempre um outcome declarado, nunca uma exceção não tratada por uma falha de infraestrutura. */
async function callRpc(client: GoogleCalendarRpcClient, name: string, parameters: Readonly<Record<string, unknown>>): Promise<Record<string, unknown> | null> {
  try {
    const response = await client.rpc(name, parameters);
    if (response.error !== null) return null;
    return ownRecord(response.data);
  } catch {
    return null;
  }
}

/**
 * Mesmo padrão de gating de `id-token.ts`/`oauth-state.ts`/a rota de
 * callback OAuth (onda 1b-ii): `googleCalendarFakeProvidersEnabled()` lê
 * `PORTAL_FAKE_PROVIDERS==="1"` direto do `process.env` real (a própria
 * função do pacote não aceita `env` injetado) -- testes deste módulo
 * ajustam essa variável de ambiente antes de chamar, ou passam
 * `dependencies.port` diretamente pra pular esta função inteira.
 */
function buildGoogleCalendarPort(refreshToken: string): Pick<GoogleCalendarPort, "queryFreeBusy"> {
  if (googleCalendarFakeProvidersEnabled()) return createFakeGoogleCalendarPort();
  // Credencial ausente/vazia em modo real lança `missing_credentials`
  // (`GoogleCalendarProviderError`) de dentro de `createGoogleCalendarPort`
  // -- deliberadamente não checado aqui antes: o catch abaixo, no chamador,
  // já mapeia qualquer `GoogleCalendarProviderError` (inclusive esta) pro
  // outcome declarado `provider_error`, sem precisar de um branch a mais.
  return createGoogleCalendarPort({
    clientId: (process.env.GOOGLE_OAUTH_CLIENT_ID ?? "").trim(),
    clientSecret: (process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "").trim(),
    refreshToken,
  });
}

/**
 * Orquestra `propose_meeting_slots` ponta a ponta: contexto da conexão →
 * credencial decifrada → port real/fake → disponibilidade → persistência.
 * Nunca lança para um caminho de negócio esperado (calendário desconectado,
 * sem disponibilidade, erro do provider, RPC indisponível) -- todos viram um
 * outcome declarado em `ProposeGoogleCalendarMeetingSlotsResult`. Só lança
 * pra entrada malformada de um CHAMADOR (`ProposeGoogleCalendarMeetingSlotsInputError`,
 * antes de qualquer chamada de rede) ou pra um erro genuinamente inesperado
 * que não seja `GoogleCalendarProviderError` (um bug, não uma condição de
 * negócio -- nunca deveria ser silenciado).
 */
export async function proposeGoogleCalendarMeetingSlots(
  input: ProposeGoogleCalendarMeetingSlotsInput,
  dependencies: ProposeGoogleCalendarMeetingSlotsDependencies = {},
): Promise<ProposeGoogleCalendarMeetingSlotsResult> {
  const tenantId = assertUuidV7(input.tenantId, "tenantId");
  const agentId = assertUuidV7(input.agentId, "agentId");
  const sessionId = assertUuidV7(input.sessionId, "sessionId");
  const presenterId = assertUuidV7(input.presenterId, "presenterId");
  const grantId = assertUuidV7(input.grantId, "grantId");
  const durationMinutes = assertDurationMinutes(input.durationMinutes);
  const contactName = normalizeOptionalContactName(input.contactName);
  const contactEmail = normalizeOptionalContactEmail(input.contactEmail);

  const idGenerator = dependencies.idGenerator ?? createUuidV7;
  const receiptId = input.receiptId === undefined ? assertUuidV7(idGenerator(), "receiptId") : assertUuidV7(input.receiptId, "receiptId");
  const proposalId = input.proposalId === undefined ? assertUuidV7(idGenerator(), "proposalId") : assertUuidV7(input.proposalId, "proposalId");

  const rpcClient = dependencies.rpc ?? createServiceRoleClient();

  // Passo 1: contexto da conexão (calendarId/defaultTimezone). `not_connected`
  // aqui nunca chega perto da RPC de credencial nem da de propose.
  const connectionRecord = await callRpc(rpcClient, "portal_google_calendar_connection_context_service", { p_tenant_id: tenantId });
  if (connectionRecord === null) return Object.freeze({ outcome: "service_unavailable" });
  if (connectionRecord.outcome !== "found") return Object.freeze({ outcome: "not_connected" });
  const calendarId = readString(connectionRecord, "calendarId");
  const defaultTimezone = readString(connectionRecord, "defaultTimezone");
  if (calendarId === null || defaultTimezone === null) return Object.freeze({ outcome: "service_unavailable" });

  // Passo 2: credencial decifrada (onda 1b-iii). A RPC já filtra
  // status='connected' sozinha -- um `not_connected` aqui cobre tanto a
  // corrida rara entre as duas leituras quanto revoked/reauth_required sem
  // este módulo precisar duplicar aquela lógica de status.
  const tokenRecord = await callRpc(rpcClient, "portal_google_calendar_decrypted_refresh_token_service", { p_tenant_id: tenantId });
  if (tokenRecord === null) return Object.freeze({ outcome: "service_unavailable" });
  if (tokenRecord.outcome !== "found") return Object.freeze({ outcome: "not_connected" });
  const refreshToken = readString(tokenRecord, "refreshToken");
  if (refreshToken === null) return Object.freeze({ outcome: "service_unavailable" });

  // Passo 3: disponibilidade real. Qualquer GoogleCalendarProviderError vira
  // um outcome declarado -- reauth_required tem um outcome próprio (ADR-039:
  // isto NUNCA escreve status='reauth_required' na conexão, é trabalho do
  // worker periódico futuro que a própria ADR já descreve como fora de
  // escopo); qualquer outro código do provider (timeout, malformed,
  // provider_rejected, provider_unavailable, missing_credentials...) vira
  // `provider_error` com o código original preservado (metadado seguro,
  // nunca contém segredo).
  let slots: readonly ProposedCalendarSlot[];
  try {
    const port = dependencies.port ?? buildGoogleCalendarPort(refreshToken);
    slots = await computeGoogleCalendarAvailableSlots(port, {
      durationMinutes,
      timezone: defaultTimezone,
      calendarId,
      maxSlots: dependencies.maxSlots ?? DEFAULT_MAX_PROPOSED_SLOTS,
      ...(dependencies.businessDaysCount === undefined ? {} : { businessDaysCount: dependencies.businessDaysCount }),
      ...(dependencies.businessStartHour === undefined ? {} : { businessStartHour: dependencies.businessStartHour }),
      ...(dependencies.businessEndHour === undefined ? {} : { businessEndHour: dependencies.businessEndHour }),
      ...(dependencies.clock === undefined ? {} : { clock: dependencies.clock }),
      idGenerator,
    });
  } catch (error) {
    if (error instanceof GoogleCalendarProviderError) {
      if (error.code === "reauth_required") return Object.freeze({ outcome: "reauth_required" });
      return Object.freeze({ outcome: "provider_error", providerErrorCode: error.code });
    }
    throw error;
  }

  // Passo 4: a RPC exige jsonb_array_length(p_slots) between 1 and 50 --
  // zero slots disponíveis (calendário lotado o período inteiro) é tratado
  // como outcome declarado ANTES de chamar a RPC, nunca deixando-a estourar
  // com um array vazio.
  if (slots.length === 0) return Object.freeze({ outcome: "no_availability" });

  const proposeRecord = await callRpc(rpcClient, "portal_propose_business_meeting_slots_service", {
    p_receipt_id: receiptId,
    p_proposal_id: proposalId,
    p_grant_id: grantId,
    p_tenant_id: tenantId,
    p_agent_id: agentId,
    p_session_id: sessionId,
    p_presenter_id: presenterId,
    p_duration_minutes: durationMinutes,
    p_timezone: defaultTimezone,
    // Exatamente 3 chaves por elemento -- a RPC rejeita qualquer outra
    // contagem (`jsonb_object_keys(x)<>3`), então `timezone` (presente em
    // `ProposedCalendarSlot`, útil pro chamador/UI) é descartado aqui de
    // propósito: o fuso vale pra proposta inteira via `p_timezone`, não por
    // slot (ver `portal_business_action_proposal_slots.timezone`, coluna
    // preenchida a partir de `p_timezone`, não de um valor por linha).
    p_slots: slots.map((slot) => ({ id: slot.id, startAt: slot.startAt, endAt: slot.endAt })),
    p_contact_name: contactName,
    p_contact_email: contactEmail,
  });
  if (proposeRecord === null) return Object.freeze({ outcome: "service_unavailable" });

  if (proposeRecord.outcome === "succeeded") {
    const returnedProposalId = readString(proposeRecord, "proposalId");
    const returnedReceiptId = readString(proposeRecord, "receiptId");
    if (returnedProposalId === null || returnedReceiptId === null) return Object.freeze({ outcome: "service_unavailable" });
    // Numa chamada nova (o caminho normal), `slots` É exatamente o que
    // acabou de ser persistido. Numa REPLAY genuína (mesmo grantId chamado
    // duas vezes -- só deveria acontecer por um retry de transporte com o
    // mesmo commandId/tool_call_id), a RPC devolve o proposalId/receiptId JÁ
    // EXISTENTES sem tocar `p_slots` de novo; `slots`, aqui, reflete o que
    // ESTA chamada acabou de calcular (a disponibilidade real pode ter
    // mudado nos segundos entre as duas tentativas), não necessariamente a
    // lista originalmente persistida. Ler de volta a lista autoritativa
    // exigiria uma RPC de leitura que não existe hoje -- fora de escopo
    // desta onda (limitação conhecida, documentada aqui de propósito, Art. 16).
    return Object.freeze({ outcome: "succeeded", proposalId: returnedProposalId, receiptId: returnedReceiptId, slots });
  }
  if (proposeRecord.outcome === "rejected") {
    const reason = readString(proposeRecord, "reason");
    return Object.freeze({ outcome: "rejected", reason: reason ?? "unknown" });
  }
  return Object.freeze({ outcome: "service_unavailable" });
}
