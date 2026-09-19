/**
 * ADR-039, a orquestração "dispatch → Google → commit" que a própria ADR já
 * descrevia como trabalho separado da onda 1b (0052), e que ADR-041 nomeia
 * explicitamente (linha 217: "o outcome de sucesso real depende da
 * orquestração dispatch → Google → commit que o próprio ADR-039 já descreve
 * como trabalho separado"; linha 258: "este ADR não constrói um bloqueio
 * técnico contra ligar `auto_confirm_scheduling` cedo demais... a disciplina
 * de não ligar é operacional, não estrutural, até que exista uma trava de
 * código"). Esta função É essa trava: `confirm_meeting_slot` só chega a um
 * evento real no Google Calendar por aqui.
 *
 * Espelha deliberadamente `apps/portal/src/lib/actions/stripe-checkout-approval.ts`
 * (a mesma orquestração construída nesta mesma sessão pro domínio de
 * checkout via Stripe Connect, ADR-040): dispatch (fence + snapshot
 * atômicos) → chamada ao provider externo → commit, com a mesma
 * classificação de falha declarada-vs-ambígua. Diferença estrutural: aqui
 * não existe aprovação humana (o gate é só `auto_confirm_scheduling` por
 * agente), e o provider tem um mecanismo de recuperação idempotente próprio
 * que checkout não tem -- `event_id_conflict` (409) significa que uma
 * tentativa anterior pode ter criado o evento de verdade antes de a resposta
 * se perder; `getEvent` recupera o evento real em vez de tratar isso como
 * ambíguo (ver o cabeçalho de `packages/provider-google-calendar/src/index.ts`
 * sobre "Events.insert com id gerado pelo chamador").
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

import type { GoogleCalendarRpcClient, GoogleCalendarRpcResult } from "./propose-meeting-slots.ts";
import { createServiceRoleClient } from "../supabase/service.ts";

export class DispatchMeetingReservationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DispatchMeetingReservationInputError";
  }
}

export interface DispatchMeetingReservationInput {
  readonly tenantId: string;
  readonly reservationId: string;
}

export interface DispatchMeetingReservationDependencies {
  readonly rpc?: GoogleCalendarRpcClient;
  /** Bypassa a seleção real/fake por `PORTAL_FAKE_PROVIDERS` -- uso principal: testes. */
  readonly port?: Pick<GoogleCalendarPort, "insertEvent" | "getEvent">;
  readonly idGenerator?: () => string;
}

export type DispatchMeetingReservationResult =
  | Readonly<{ readonly outcome: "committed"; readonly reservationId: string; readonly googleEventId: string; readonly startAt: string; readonly endAt: string; readonly timezone: string }>
  /** acquired:false com state em {committed,completed}: já comitado por um despacho anterior/concorrente. Seguro afirmar sucesso de novo (idempotente). */
  | Readonly<{ readonly outcome: "already_committed" }>
  /** acquired:false com state='provider_in_flight': outro despacho concorrente está em voo agora. Genuinamente incerto (não sabemos se vai terminar em sucesso), nunca um sucesso afirmado. */
  | Readonly<{ readonly outcome: "in_progress" }>
  /** acquired:false com qualquer outro state (released/unknown/reserved de novo): nunca deveria acontecer logo depois de reserve() -- sinal de bug ou corrida genuinamente inesperada. */
  | Readonly<{ readonly outcome: "not_dispatchable" }>
  /** A conexão do calendário caiu entre o reserve e o dispatch: desfecho DECLARADO (nada foi enviado à Google), a reserva é liberada com `calendar_disconnected_at_dispatch`. */
  | Readonly<{ readonly outcome: "not_connected" }>
  /** Qualquer falha depois que a fence foi adquirida e a leitura de credencial já confirmou conexão: tratada como ambígua de propósito (mesma disciplina do ADR-036), marcada `unknown` pra reconciliação humana. */
  | Readonly<{ readonly outcome: "ambiguous"; readonly providerErrorCode: GoogleCalendarProviderErrorCode | "unknown" }>
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
  if (typeof value !== "string" || !UUID_V7_PATTERN.test(value)) throw new DispatchMeetingReservationInputError(`${name} must be a UUIDv7`);
  return value;
}

/** Mesmo padrão de `proposeGoogleCalendarMeetingSlots`: `null` cobre uniformemente falha de transporte e `{error}`, sempre um outcome declarado, nunca uma exceção não tratada. */
async function callRpc(client: GoogleCalendarRpcClient, name: string, parameters: Readonly<Record<string, unknown>>): Promise<Record<string, unknown> | null> {
  try {
    const response: GoogleCalendarRpcResult = await client.rpc(name, parameters);
    if (response.error !== null) return null;
    return ownRecord(response.data);
  } catch {
    return null;
  }
}

function buildGoogleCalendarPort(refreshToken: string): Pick<GoogleCalendarPort, "insertEvent" | "getEvent"> {
  if (googleCalendarFakeProvidersEnabled()) return createFakeGoogleCalendarPort();
  return createGoogleCalendarPort({
    clientId: (process.env.GOOGLE_OAUTH_CLIENT_ID ?? "").trim(),
    clientSecret: (process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "").trim(),
    refreshToken,
  });
}

function meetingSummary(contactName: string | null): string {
  return contactName === null ? "Reunião agendada" : `Reunião com ${contactName}`;
}

/**
 * Orquestra o dispatch de uma reserva `confirm_meeting_slot` já `reserved`:
 * adquire a fence, insere o evento real no Google Calendar (com recuperação
 * idempotente em `event_id_conflict`) e comita. Nunca lança para um caminho
 * de negócio esperado -- todo desfecho vira um outcome declarado em
 * `DispatchMeetingReservationResult`. Só lança pra `tenantId`/`reservationId`
 * malformados (bug do chamador, nunca deveria acontecer logo depois de um
 * `reserveBusinessMeetingSlot` bem-sucedido).
 */
export async function dispatchMeetingReservation(
  input: DispatchMeetingReservationInput,
  dependencies: DispatchMeetingReservationDependencies = {},
): Promise<DispatchMeetingReservationResult> {
  const tenantId = assertUuidV7(input.tenantId, "tenantId");
  const reservationId = assertUuidV7(input.reservationId, "reservationId");
  const rpcClient = dependencies.rpc ?? createServiceRoleClient();
  const idGenerator = dependencies.idGenerator ?? createUuidV7;

  const dispatchRecord = await callRpc(rpcClient, "portal_dispatch_business_meeting_reservation_service", {
    p_tenant_id: tenantId,
    p_reservation_id: reservationId,
  });
  if (dispatchRecord === null) return Object.freeze({ outcome: "service_unavailable" });

  if (dispatchRecord.acquired !== true) {
    const state = dispatchRecord.state;
    if (state === "committed" || state === "completed") return Object.freeze({ outcome: "already_committed" });
    if (state === "provider_in_flight") return Object.freeze({ outcome: "in_progress" });
    return Object.freeze({ outcome: "not_dispatchable" });
  }

  const googleEventId = readString(dispatchRecord, "googleEventId");
  const googleCalendarId = readString(dispatchRecord, "googleCalendarId");
  const startAt = readString(dispatchRecord, "startAt");
  const endAt = readString(dispatchRecord, "endAt");
  const timezone = readString(dispatchRecord, "timezone");
  const contactName = readString(dispatchRecord, "contactName");
  const contactEmail = readString(dispatchRecord, "contactEmail");
  if (googleEventId === null || googleCalendarId === null || startAt === null || endAt === null || timezone === null) {
    return Object.freeze({ outcome: "service_unavailable" });
  }

  // Credencial decifrada. A própria RPC confirma status='connected' e nunca
  // lança -- {outcome:'not_connected'} aqui é um desfecho DECLARADO (nada
  // foi enviado à Google ainda), então libera com evidência dedicada em vez
  // de marcar unknown.
  const tokenRecord = await callRpc(rpcClient, "portal_google_calendar_decrypted_refresh_token_service", { p_tenant_id: tenantId });
  if (tokenRecord === null) return Object.freeze({ outcome: "service_unavailable" });
  if (tokenRecord.outcome !== "found") {
    await callRpc(rpcClient, "portal_release_business_meeting_reservation_service", {
      p_tenant_id: tenantId,
      p_reservation_id: reservationId,
      p_receipt_id: assertUuidV7(idGenerator(), "receiptId"),
      p_evidence: "calendar_disconnected_at_dispatch",
    });
    return Object.freeze({ outcome: "not_connected" });
  }
  const refreshToken = readString(tokenRecord, "refreshToken");
  if (refreshToken === null) return Object.freeze({ outcome: "service_unavailable" });

  // `port` só é atribuída dentro do try: construir o port real também pode
  // lançar de forma síncrona (ex.: GOOGLE_OAUTH_CLIENT_ID/_SECRET ausentes),
  // e essa falha precisa cair na mesma disciplina ambígua-por-baixo de tudo
  // que segue a fence -- nunca propagar como exceção não tratada.
  let port: Pick<GoogleCalendarPort, "insertEvent" | "getEvent"> | null = null;
  let insertedEvent: { readonly id: string; readonly htmlLink: string | null } | null = null;
  try {
    port = dependencies.port ?? buildGoogleCalendarPort(refreshToken);
    const inserted = await port.insertEvent({
      calendarId: googleCalendarId,
      eventId: googleEventId,
      summary: meetingSummary(contactName),
      startIso: startAt,
      endIso: endAt,
      timeZone: timezone,
      ...(contactEmail === null ? {} : { attendeeEmails: [contactEmail] }),
    });
    insertedEvent = { id: inserted.id, htmlLink: inserted.htmlLink };
  } catch (error) {
    if (port !== null && error instanceof GoogleCalendarProviderError && error.code === "event_id_conflict") {
      // Retry-safe recovery (mesmo mecanismo documentado no cabeçalho de
      // provider-google-calendar): um insert anterior pode ter chegado à
      // Google com sucesso antes de a resposta se perder. getEvent confirma.
      try {
        const recovered = await port.getEvent(googleCalendarId, googleEventId);
        insertedEvent = { id: recovered.id, htmlLink: recovered.htmlLink };
      } catch {
        insertedEvent = null;
      }
    }
  }

  if (insertedEvent === null) {
    // Qualquer outra falha (rede, timeout, reauth_required, resposta
    // malformada, ou event_id_conflict cuja recuperação por getEvent também
    // falhou) é tratada como ambígua de propósito: a fence já foi adquirida,
    // então não há como distinguir com segurança "a Google nunca recebeu o
    // pedido" de "recebeu, mas a resposta se perdeu" sem inspecionar o
    // Google Calendar diretamente -- mesma disciplina do ADR-036 pra todo
    // efeito externo, mesma escolha já feita pro domínio de checkout.
    await callRpc(rpcClient, "portal_mark_business_meeting_reservation_unknown_service", {
      p_tenant_id: tenantId,
      p_reservation_id: reservationId,
      p_failure_code: "google_calendar_insert_failed",
    });
    return Object.freeze({ outcome: "ambiguous", providerErrorCode: "unknown" });
  }

  const commitRecord = await callRpc(rpcClient, "portal_commit_business_meeting_reservation_service", {
    p_tenant_id: tenantId,
    p_reservation_id: reservationId,
    p_receipt_id: assertUuidV7(idGenerator(), "receiptId"),
    p_google_event_html_link: insertedEvent.htmlLink,
  });
  if (commitRecord === null || commitRecord.outcome !== "succeeded") {
    // O evento JÁ EXISTE no Google Calendar neste ponto; só a gravação local
    // falhou. Marca unknown em vez de perder o evento: um operador recupera
    // via portal_reconcile_business_meeting_reservation_service.
    await callRpc(rpcClient, "portal_mark_business_meeting_reservation_unknown_service", {
      p_tenant_id: tenantId,
      p_reservation_id: reservationId,
      p_failure_code: "calendar_commit_write_failed",
    });
    return Object.freeze({ outcome: "ambiguous", providerErrorCode: "unknown" });
  }

  return Object.freeze({ outcome: "committed", reservationId, googleEventId, startAt, endAt, timezone });
}
