/**
 * Quarto adapter de provider real do projeto: Telnyx — telefonia (Voice +
 * Messaging) pro que um closer de vendas precisa hoje: ligar pra um número,
 * mandar um SMS, e saber o status de cada um. Mesmos guardrails dos outros
 * três adapters reais (OpenRouter, Tavus, Recall.ai): fetch injetável,
 * timeout obrigatório, chave nunca aparece em erro/log, erro tipado, caps
 * fechados de input.
 *
 * ATENÇÃO — hipótese de integração, não fato confirmado (classificação do
 * Art. 16 da constituição deste repo: toda afirmação técnica é fato
 * confirmado, decisão, hipótese de benchmark, dependência externa ou item
 * adiado). `TASKS.md` linha ~32 registrava a decisão autônoma anterior de
 * NÃO construir isto especulativamente ("código não testável contra API
 * real vira scaffolding morto"). Essa decisão foi conscientemente revertida
 * por pedido explícito do Fernando Silva em 2026-08-24 — telefonia virou
 * prioridade de produto nesta rodada, mesmo sem conta/chave Telnyx ainda
 * existir. O modo REAL abaixo foi desenhado lendo a documentação pública
 * real da Telnyx (OpenAPI spec oficial, não memória de treino) e NUNCA foi
 * exercitado contra a API de verdade — é dependência externa não validada
 * até uma conta real existir. `createFakeTelnyxPort` (zero rede) é o único
 * modo seguro de usar este pacote até essa validação acontecer.
 *
 * Fontes consultadas (2026-08-24):
 * - Base URL + esquema de auth: https://developers.telnyx.com/docs/api/v2/overview
 *   ("Authorization: Bearer <API_KEY>"). `servers[0].url` da OpenAPI spec
 *   confirma `https://api.telnyx.com/v2`. Difere do Recall.ai (`Authorization`
 *   sem "Bearer") e do Tavus (header `x-api-key`) — cada provider tem seu
 *   próprio esquema, nenhum foi assumido por analogia.
 * - Voice — discar: OpenAPI spec pública (raw.githubusercontent.com/
 *   team-telnyx/openapi/master/openapi/spec3.json), `paths["/calls"].post`
 *   (operationId `DialCall`) + `components.schemas.CallRequest`. Campos
 *   obrigatórios: `connection_id`, `to`, `from`. Resposta 200 em
 *   `components.schemas.CallWithRecordingId` (`call_control_id`,
 *   `call_leg_id`, `call_session_id`), envelopada em `{"data": ...}`.
 * - Voice — status: mesma spec, `paths["/calls/{call_control_id}"].get`
 *   (operationId `RetrieveCallStatus`) — descrição literal da própria
 *   Telnyx: "Returns the status of a call (data is available 10 minutes
 *   after call ended)". NÃO é status em tempo real; existe pra reconciliação
 *   tardia, não para acompanhar uma chamada em andamento.
 * - Messaging — enviar: mesma spec, `paths["/messages"].post` (operationId
 *   `SendMessage`) + `components.schemas.CreateMessageRequest`. Resposta em
 *   `components.schemas.messaging_OutboundMessagePayload`, também envelopada
 *   em `{"data": ...}`.
 * - Messaging — status: mesma spec, `paths["/messages/{id}"].get`
 *   (operationId `GetMessage`) — descrição literal: só recupera mensagens de
 *   até 10 dias desde a criação.
 * - Webhooks (mecanismo de status escolhido — ver decisão abaixo):
 *   https://developers.telnyx.com/docs/voice/programmable-voice/receiving-webhooks
 *   + a própria OpenAPI spec (chave `webhooks`) — todo webhook Telnyx traz os
 *   headers `telnyx-timestamp` (unix seconds) e `telnyx-signature-ed25519`
 *   (assinatura Ed25519, base64, do texto `${timestamp}|${raw_body}`) —
 *   citação literal da spec: "Ed25519 signature of timestamp|payload for
 *   verification". Eventos de voz confirmados na spec: `call.initiated`,
 *   `call.answered`, `call.hangup` (com `hangup_cause` fechado num enum).
 *   Eventos de mensagem confirmados: `message.sent`, `message.finalized`
 *   (status granular de entrega vem em `payload.to[].status`).
 *
 * DECISÃO — webhook vs. polling para status (capacidade 3 do escopo): os
 * dois GET acima existem, mas nenhum serve como fonte de status em tempo
 * real (o de chamada só populariza 10min DEPOIS da chamada acabar; o de
 * mensagem é uma consulta pontual, não um fluxo). A doc real da Telnyx é
 * explícita que o webhook é o mecanismo pensado pra acompanhar o ciclo de
 * vida — por isso este pacote expõe AMBOS: `getCallStatus`/`getMessageStatus`
 * (polling, com a limitação documentada em cada um) E
 * `verifyTelnyxWebhookSignature`/`parseTelnyxCallWebhookEvent`/
 * `parseTelnyxMessageWebhookEvent` (webhook, o caminho recomendado). A
 * verificação de assinatura mora AQUI, dentro do package, e não em
 * `apps/portal` (onde o mesmo tipo de lógica vive pra Recall.ai/Stripe —
 * ver `apps/portal/src/lib/meetings/webhook.ts` e `.../billing/webhook.ts`)
 * porque esta rodada constrói só o package isolado, sem tocar Server
 * Actions/rotas do portal (fora de escopo aqui). Quando uma onda futura
 * conectar isto ao produto, uma rota `apps/portal/src/app/api/telnyx/
 * webhook/route.ts` deve importar esta função pura — mesmo padrão dos
 * outros dois webhooks assinados do repo, só que fisicamente hospedada no
 * package por causa do limite de escopo desta tarefa.
 *
 * AMBIGUIDADE DOCUMENTADA (Art. 16 — não inventar o que a doc não confirma):
 * 1. `call_control_id` não tem formato fechado na doc (só `type: string` no
 *    parâmetro de path; o prefixo `v3:` aparece SÓ em exemplos, nunca como
 *    invariante declarado) — diferente do bot id da Recall.ai, documentado
 *    como UUID. Por isso este pacote valida só presença/tamanho, nunca um
 *    regex de formato, e usa `encodeURIComponent` no path como mitigação
 *    (em vez de confiar num regex que seria inventado).
 * 2. O comportamento de `hangupCall`/`getCallStatus` contra um
 *    `call_control_id` desconhecido ou expirado (404? 422? idempotente como
 *    o `leaveCall` da Recall.ai?) não está confirmado na doc pública — o
 *    modo fake escolhe `provider_rejected`/422 como placeholder plausível,
 *    NÃO como contrato confirmado. Validar contra sandbox real antes de
 *    depender disso em produção.
 * 3. A Messaging API (`POST /messages`) NÃO tem nenhum campo de dedup/
 *    idempotência equivalente ao `command_id` do Dial de voz — reenviar o
 *    mesmo SMS por retry cria DUAS mensagens cobradas, sempre. Isto é uma
 *    lacuna real do provider, não um detalhe que faltou modelar aqui; um
 *    futuro call site em `apps/portal` precisa da mesma reserva idempotente
 *    por `(tenant_id, idempotency_key)` que já existe pra Tavus/Recall
 *    (`beginProviderEffect`), porque a Telnyx não oferece proteção nativa
 *    pra SMS como oferece pra Dial.
 * 4. Retry com backoff exponencial NÃO é implementado dentro deste adapter
 *    — mesmo padrão de `provider-recall`/`provider-tavus`: uma falha vira
 *    um erro tipado (`provider_timeout`/`provider_unavailable`/...) numa
 *    única tentativa, e quem decide retentar (com que backoff, quantas
 *    vezes) é a camada de cima, que hoje nem existe pra Telnyx (fora do
 *    escopo desta rodada — nenhuma Server Action foi tocada).
 */

import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";

// ---------------------------------------------------------------------------
// Erro tipado
// ---------------------------------------------------------------------------

export type TelnyxProviderErrorCode =
  | "missing_api_key"
  | "invalid_request"
  | "provider_rejected"
  | "provider_timeout"
  | "provider_unavailable"
  | "malformed_provider_response";

export class TelnyxProviderError extends Error {
  readonly code: TelnyxProviderErrorCode;
  /** Provider HTTP status when a response was received; absent for local/network failures. */
  readonly httpStatus: number | null;
  constructor(code: TelnyxProviderErrorCode, message: string, httpStatus: number | null = null) {
    super(message);
    this.name = "TelnyxProviderError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// ---------------------------------------------------------------------------
// Voice (Call Control)
// ---------------------------------------------------------------------------

export interface TelnyxCallRequest {
  /** +E.164. Doc: "The DID or SIP URI to dial out to" — este pacote cobre só o caso DID (número), SIP URI é fora de escopo. */
  readonly to: string;
  /** +E.164, caller id apresentado ao destino. */
  readonly from: string;
  /** ID do Call Control App (antigo "connection id") a usar pra discar. */
  readonly connectionId: string;
  /** Sobrescreve, só para esta chamada, o webhook_url configurado na conta. */
  readonly webhookUrl?: string;
  /** Ecoado em todo webhook subsequente. Doc pede base64, mas não valida no request — não fechamos um regex de base64 aqui por não ser um invariante confirmado. */
  readonly clientState?: string;
  /** Doc: "Telnyx will ignore other Dial commands with the same command_id" — único mecanismo de idempotência nativo do Dial. */
  readonly commandId?: string;
  /** Segundos até desistir se ninguém atender. Doc (texto, não no schema): mínimo 5, máximo 600; default 30. */
  readonly timeoutSecs?: number;
}

export interface TelnyxCall {
  readonly callControlId: string;
  readonly callLegId: string;
  readonly callSessionId: string;
}

export interface TelnyxCallStatus {
  readonly callControlId: string;
  readonly callLegId: string;
  readonly callSessionId: string;
  /** Doc: "For Dial command it will always be false (dialing is asynchronous)" logo após a criação — só fica true depois de atendida. */
  readonly isAlive: boolean;
  readonly callDurationSeconds: number | null;
  readonly startTime: string | null;
  /** Só presente quando a chamada não está mais ativa (doc). */
  readonly endTime: string | null;
}

export interface TelnyxVoicePort {
  readonly providerId: string;
  dialCall(request: TelnyxCallRequest): Promise<TelnyxCall>;
  hangupCall(callControlId: string): Promise<void>;
  /**
   * `GET /v2/calls/{call_control_id}` — doc oficial: "data is available 10
   * minutes after call ended". NÃO confunda com status em tempo real; para
   * acompanhar uma chamada em andamento use o webhook
   * (`parseTelnyxCallWebhookEvent`/`verifyTelnyxWebhookSignature`).
   */
  getCallStatus(callControlId: string): Promise<TelnyxCallStatus>;
}

// ---------------------------------------------------------------------------
// Messaging (SMS)
// ---------------------------------------------------------------------------

export interface TelnyxMessageRequest {
  readonly to: string;
  readonly from: string;
  readonly text: string;
  readonly webhookUrl?: string;
}

export type TelnyxMessageDeliveryStatus =
  | "queued"
  | "sending"
  | "sent"
  | "expired"
  | "sending_failed"
  | "delivery_unconfirmed"
  | "delivered"
  | "delivery_failed";

export interface TelnyxMessage {
  readonly id: string;
  readonly recordType: "message";
  readonly to: string;
  readonly status: TelnyxMessageDeliveryStatus;
}

export interface TelnyxMessagingPort {
  readonly providerId: string;
  sendMessage(request: TelnyxMessageRequest): Promise<TelnyxMessage>;
  /** `GET /v2/messages/{id}` — doc oficial: só recupera mensagens de até 10 dias desde a criação. */
  getMessageStatus(messageId: string): Promise<TelnyxMessage>;
}

export type TelnyxPort = TelnyxVoicePort & TelnyxMessagingPort;

// ---------------------------------------------------------------------------
// Validação de input (compartilhada entre o adapter real e o fake — o
// "contrato" de validação precisa ser idêntico nos dois modos, senão o modo
// fake mentiria sobre o que a API real aceita).
// ---------------------------------------------------------------------------

const E164_PATTERN = /^\+[1-9]\d{1,14}$/;
const MAX_CONNECTION_ID_CHARS = 128;
const MAX_CALL_CONTROL_ID_CHARS = 2000;
/** Bound defensivo nosso — a doc não fecha um tamanho máximo pra client_state além de "deve ser base64 válido". */
const MAX_CLIENT_STATE_CHARS = 2000;
const MAX_COMMAND_ID_CHARS = 128;
const MAX_WEBHOOK_URL_CHARS = 2000;
/** Bound defensivo nosso: ~10 partes GSM-7 concatenadas (doc: `parts` vai de 1 a 10). Não é um limite documentado pela Telnyx, é nosso. */
const MAX_TEXT_CHARS = 1600;
const MIN_TIMEOUT_SECS = 5;
const MAX_TIMEOUT_SECS = 600;
const MESSAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_TIMEOUT_MS = 20_000;

function isE164(value: unknown): value is string {
  return typeof value === "string" && E164_PATTERN.test(value);
}

function isHttpsUrl(value: string, maxChars: number): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > maxChars) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validateCallRequest(request: TelnyxCallRequest): void {
  if (!isE164(request.to)) throw new TelnyxProviderError("invalid_request", "to must be an E.164 phone number");
  if (!isE164(request.from)) throw new TelnyxProviderError("invalid_request", "from must be an E.164 phone number");
  if (typeof request.connectionId !== "string" || request.connectionId.length === 0 || request.connectionId.length > MAX_CONNECTION_ID_CHARS) {
    throw new TelnyxProviderError("invalid_request", `connectionId must be 1..${MAX_CONNECTION_ID_CHARS} chars`);
  }
  if (request.webhookUrl !== undefined && !isHttpsUrl(request.webhookUrl, MAX_WEBHOOK_URL_CHARS)) {
    throw new TelnyxProviderError("invalid_request", "webhookUrl must be an https URL");
  }
  if (request.clientState !== undefined && (request.clientState.length === 0 || request.clientState.length > MAX_CLIENT_STATE_CHARS)) {
    throw new TelnyxProviderError("invalid_request", `clientState must be 1..${MAX_CLIENT_STATE_CHARS} chars`);
  }
  if (request.commandId !== undefined && (request.commandId.length === 0 || request.commandId.length > MAX_COMMAND_ID_CHARS)) {
    throw new TelnyxProviderError("invalid_request", `commandId must be 1..${MAX_COMMAND_ID_CHARS} chars`);
  }
  if (request.timeoutSecs !== undefined
    && (!Number.isInteger(request.timeoutSecs) || request.timeoutSecs < MIN_TIMEOUT_SECS || request.timeoutSecs > MAX_TIMEOUT_SECS)) {
    throw new TelnyxProviderError("invalid_request", `timeoutSecs must be ${MIN_TIMEOUT_SECS}..${MAX_TIMEOUT_SECS}`);
  }
}

function validateCallControlId(callControlId: string): void {
  if (typeof callControlId !== "string" || callControlId.length === 0 || callControlId.length > MAX_CALL_CONTROL_ID_CHARS) {
    throw new TelnyxProviderError("invalid_request", "callControlId must be a non-empty string");
  }
}

function validateMessageRequest(request: TelnyxMessageRequest): void {
  if (!isE164(request.to)) throw new TelnyxProviderError("invalid_request", "to must be an E.164 phone number");
  if (!isE164(request.from)) throw new TelnyxProviderError("invalid_request", "from must be an E.164 phone number");
  if (typeof request.text !== "string" || request.text.length === 0 || request.text.length > MAX_TEXT_CHARS) {
    throw new TelnyxProviderError("invalid_request", `text must be 1..${MAX_TEXT_CHARS} chars`);
  }
  if (request.webhookUrl !== undefined && !isHttpsUrl(request.webhookUrl, MAX_WEBHOOK_URL_CHARS)) {
    throw new TelnyxProviderError("invalid_request", "webhookUrl must be an https URL");
  }
}

function validateMessageId(messageId: string): void {
  if (typeof messageId !== "string" || !MESSAGE_ID_PATTERN.test(messageId)) {
    throw new TelnyxProviderError("invalid_request", "messageId must be a plain Telnyx message UUID");
  }
}

const MESSAGE_STATUSES = new Set<TelnyxMessageDeliveryStatus>([
  "queued", "sending", "sent", "expired", "sending_failed",
  "delivery_unconfirmed", "delivered", "delivery_failed",
]);

function parseMessagePayload(payload: unknown): TelnyxMessage {
  const record = (payload ?? {}) as Record<string, unknown>;
  const id = record.id;
  if (typeof id !== "string" || id.length === 0) {
    throw new TelnyxProviderError("malformed_provider_response", "Telnyx message payload has no id");
  }
  // Esta fatia só cobre SMS de saída (o closer discando/mandando pro
  // prospect); uma mensagem inbound devolvida aqui significa que o
  // chamador consultou o id errado, não é um contrato que valha a pena
  // modelar nesta rodada (fora de escopo — sem inbound SMS no produto).
  if (record.direction !== "outbound") {
    throw new TelnyxProviderError("malformed_provider_response", "Telnyx message payload is not an outbound message");
  }
  const toList = record.to;
  if (!Array.isArray(toList) || toList.length === 0) {
    throw new TelnyxProviderError("malformed_provider_response", "Telnyx message payload has no recipient");
  }
  const firstRecipient = (toList[0] ?? {}) as Record<string, unknown>;
  const phoneNumber = firstRecipient.phone_number;
  const status = firstRecipient.status;
  if (typeof phoneNumber !== "string" || phoneNumber.length === 0) {
    throw new TelnyxProviderError("malformed_provider_response", "Telnyx message payload has no recipient phone number");
  }
  if (typeof status !== "string" || !MESSAGE_STATUSES.has(status as TelnyxMessageDeliveryStatus)) {
    throw new TelnyxProviderError("malformed_provider_response", "Telnyx message payload has an unknown delivery status");
  }
  return Object.freeze({ id, recordType: "message" as const, to: phoneNumber, status: status as TelnyxMessageDeliveryStatus });
}

// ---------------------------------------------------------------------------
// Adapter real
// ---------------------------------------------------------------------------

export interface TelnyxAdapterOptions {
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch;
}

const BASE = "https://api.telnyx.com/v2";

export function createTelnyxPort(options: TelnyxAdapterOptions): TelnyxPort {
  const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  if (apiKey.length < 8) throw new TelnyxProviderError("missing_api_key", "Telnyx API key is not configured");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImplementation = options.fetchImplementation ?? fetch;

  async function call(method: "POST" | "GET", path: string, body?: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImplementation(`${BASE}${path}`, {
        method,
        signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof Error && error.name === "AbortError") {
        throw new TelnyxProviderError("provider_timeout", `Telnyx timed out after ${timeoutMs}ms`);
      }
      throw new TelnyxProviderError("provider_unavailable", "Telnyx request failed before a response");
    }
    // O timer segue vivo até o CORPO ser consumido — headers rápidos com
    // body pendurado não escapam do timeout (mesmo achado de auditoria já
    // corrigido em provider-recall/provider-tavus).
    try {
      if (!response.ok) {
        const code: TelnyxProviderErrorCode = response.status >= 500 ? "provider_unavailable" : "provider_rejected";
        throw new TelnyxProviderError(code, `Telnyx respondeu HTTP ${response.status}`, response.status);
      }
      const text = await response.text();
      if (text.length === 0) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new TelnyxProviderError("malformed_provider_response", "Telnyx returned non-JSON output");
      }
      // Toda resposta v2 da Telnyx vem envelopada em {"data": ...} (confirmado
      // na OpenAPI spec pra /calls, /calls/{id}, /messages e /messages/{id})
      // — diferente do Recall.ai e do Tavus, que devolvem o objeto direto.
      const record = (parsed ?? {}) as Record<string, unknown>;
      return record.data ?? null;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new TelnyxProviderError("provider_timeout", `Telnyx timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    providerId: "telnyx",

    async dialCall(request: TelnyxCallRequest): Promise<TelnyxCall> {
      validateCallRequest(request);
      const payload = await call("POST", "/calls", {
        to: request.to,
        from: request.from,
        connection_id: request.connectionId,
        ...(request.webhookUrl ? { webhook_url: request.webhookUrl } : {}),
        ...(request.clientState ? { client_state: request.clientState } : {}),
        ...(request.commandId ? { command_id: request.commandId } : {}),
        ...(request.timeoutSecs !== undefined ? { timeout_secs: request.timeoutSecs } : {}),
      });
      const record = (payload ?? {}) as Record<string, unknown>;
      const callControlId = record.call_control_id;
      const callLegId = record.call_leg_id;
      const callSessionId = record.call_session_id;
      if (typeof callControlId !== "string" || callControlId.length === 0
        || typeof callLegId !== "string" || callLegId.length === 0
        || typeof callSessionId !== "string" || callSessionId.length === 0) {
        throw new TelnyxProviderError("malformed_provider_response", "Telnyx call payload is incomplete");
      }
      return Object.freeze({ callControlId, callLegId, callSessionId });
    },

    async hangupCall(callControlId: string): Promise<void> {
      validateCallControlId(callControlId);
      // `encodeURIComponent` é a mitigação escolhida pra falta de um formato
      // fechado de call_control_id na doc (ver ambiguidade documentada no
      // topo do arquivo) — evita que um id malformado altere o path.
      await call("POST", `/calls/${encodeURIComponent(callControlId)}/actions/hangup`, {});
    },

    async getCallStatus(callControlId: string): Promise<TelnyxCallStatus> {
      validateCallControlId(callControlId);
      const payload = await call("GET", `/calls/${encodeURIComponent(callControlId)}`);
      const record = (payload ?? {}) as Record<string, unknown>;
      const callLegId = record.call_leg_id;
      const callSessionId = record.call_session_id;
      const isAlive = record.is_alive;
      if (record.call_control_id !== callControlId
        || typeof callLegId !== "string" || callLegId.length === 0
        || typeof callSessionId !== "string" || callSessionId.length === 0
        || typeof isAlive !== "boolean") {
        throw new TelnyxProviderError("malformed_provider_response", "Telnyx call status payload is incomplete");
      }
      const callDurationRaw = record.call_duration;
      const startTimeRaw = record.start_time;
      const endTimeRaw = record.end_time;
      return Object.freeze({
        callControlId,
        callLegId,
        callSessionId,
        isAlive,
        callDurationSeconds: typeof callDurationRaw === "number" ? callDurationRaw : null,
        startTime: typeof startTimeRaw === "string" ? startTimeRaw : null,
        endTime: typeof endTimeRaw === "string" ? endTimeRaw : null,
      });
    },

    async sendMessage(request: TelnyxMessageRequest): Promise<TelnyxMessage> {
      validateMessageRequest(request);
      const payload = await call("POST", "/messages", {
        to: request.to,
        from: request.from,
        text: request.text,
        ...(request.webhookUrl ? { webhook_url: request.webhookUrl } : {}),
      });
      return parseMessagePayload(payload);
    },

    async getMessageStatus(messageId: string): Promise<TelnyxMessage> {
      validateMessageId(messageId);
      const payload = await call("GET", `/messages/${encodeURIComponent(messageId)}`);
      return parseMessagePayload(payload);
    },
  });
}

// ---------------------------------------------------------------------------
// Modo fake determinístico (sem rede, sem chave real)
// ---------------------------------------------------------------------------

/**
 * Mesmo mecanismo de demo do resto do repo — ver
 * `apps/portal/src/lib/knowledge.ts` `fakeProvidersEnabled()`: a env var
 * `PORTAL_FAKE_PROVIDERS=1` liga o modo fake em todo o produto sem chave
 * real. Hoje os adapters reais de Recall.ai/Tavus decidem isso no
 * call-site, dentro de `apps/portal`, ANTES de sequer chamar o factory do
 * package. Como este package ainda não está conectado a nenhuma Server
 * Action (fora de escopo desta onda), este helper existe pra que um FUTURO
 * call site em `apps/portal` decida exatamente do mesmo jeito — e pra que
 * este próprio pacote seja testável sem chave real hoje.
 */
export function telnyxFakeProvidersEnabled(): boolean {
  return process.env.PORTAL_FAKE_PROVIDERS === "1";
}

const FAKE_CLOCK_ISO = "2026-01-01T00:00:00.000Z";

function deterministicHex(seedParts: readonly string[]): string {
  return createHash("sha256").update(seedParts.join("|"), "utf8").digest("hex");
}

function deterministicUuid(seedParts: readonly string[]): string {
  const hex = deterministicHex(seedParts).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

interface FakeCallRecord {
  readonly callLegId: string;
  readonly callSessionId: string;
  readonly isAlive: boolean;
}

interface FakeMessageRecord {
  readonly to: string;
  readonly status: TelnyxMessageDeliveryStatus;
}

/**
 * Contrato determinístico: mesmo input → mesmo id/status, sempre, sem
 * nenhuma chamada de rede. Reaplica EXATAMENTE as mesmas validações do modo
 * real (`validateCallRequest`/`validateMessageRequest`/...) — um payload
 * malformado é rejeitado da mesma forma nos dois modos, porque o objetivo do
 * fake é deixar o resto do produto testável, não fingir que qualquer input
 * passa.
 *
 * Estado (quais ids existem, se uma chamada ainda está "viva") vive em
 * memória, por instância do port — o suficiente pra um teste ou uma demo
 * local fazer `dialCall` seguido de `getCallStatus`/`hangupCall` e ver um
 * resultado coerente, sem persistência nenhuma (não é um banco).
 */
export function createFakeTelnyxPort(): TelnyxPort {
  const calls = new Map<string, FakeCallRecord>();
  const messages = new Map<string, FakeMessageRecord>();

  return Object.freeze({
    providerId: "telnyx",

    async dialCall(request: TelnyxCallRequest): Promise<TelnyxCall> {
      validateCallRequest(request);
      const callControlId = `fake_call_${deterministicHex(["call", request.to, request.from, request.connectionId, request.commandId ?? ""])}`;
      const callLegId = `fake_leg_${deterministicHex(["leg", callControlId])}`;
      const callSessionId = `fake_session_${deterministicHex(["session", callControlId])}`;
      calls.set(callControlId, { callLegId, callSessionId, isAlive: true });
      return Object.freeze({ callControlId, callLegId, callSessionId });
    },

    async hangupCall(callControlId: string): Promise<void> {
      validateCallControlId(callControlId);
      const existing = calls.get(callControlId);
      // Comportamento pra id desconhecido NÃO é confirmado contra a API real
      // (ver ambiguidade documentada no topo do arquivo) — este é um
      // placeholder plausível, não um contrato provado.
      if (existing === undefined) {
        throw new TelnyxProviderError("provider_rejected", "Fake Telnyx has no active call with this callControlId", 422);
      }
      calls.set(callControlId, { ...existing, isAlive: false });
    },

    async getCallStatus(callControlId: string): Promise<TelnyxCallStatus> {
      validateCallControlId(callControlId);
      const existing = calls.get(callControlId);
      if (existing === undefined) {
        throw new TelnyxProviderError("provider_rejected", "Fake Telnyx has no record of this callControlId", 422);
      }
      return Object.freeze({
        callControlId,
        callLegId: existing.callLegId,
        callSessionId: existing.callSessionId,
        isAlive: existing.isAlive,
        callDurationSeconds: existing.isAlive ? null : 0,
        startTime: FAKE_CLOCK_ISO,
        endTime: existing.isAlive ? null : FAKE_CLOCK_ISO,
      });
    },

    async sendMessage(request: TelnyxMessageRequest): Promise<TelnyxMessage> {
      validateMessageRequest(request);
      const id = deterministicUuid(["message", request.to, request.from, request.text]);
      messages.set(id, { to: request.to, status: "queued" });
      return Object.freeze({ id, recordType: "message" as const, to: request.to, status: "queued" as const });
    },

    async getMessageStatus(messageId: string): Promise<TelnyxMessage> {
      validateMessageId(messageId);
      const existing = messages.get(messageId);
      if (existing === undefined) {
        throw new TelnyxProviderError("provider_rejected", "Fake Telnyx has no record of this messageId", 404);
      }
      return Object.freeze({ id: messageId, recordType: "message" as const, to: existing.to, status: existing.status });
    },
  });
}

// ---------------------------------------------------------------------------
// Webhooks: verificação de assinatura (Ed25519) + parsing dos eventos
// cobertos por esta fatia (voz: initiated/answered/hangup; mensagem:
// sent/finalized). Ver o comentário "DECISÃO — webhook vs. polling" no topo
// do arquivo pra por que isto mora aqui em vez de em apps/portal.
// ---------------------------------------------------------------------------

/** Mesma tolerância de replay usada no resto do repo (`apps/portal/src/lib/{meetings,billing}/webhook.ts`). */
const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export interface TelnyxWebhookSignatureHeaders {
  /** Header `telnyx-timestamp` — unix seconds, como string. */
  readonly timestamp: string | null;
  /** Header `telnyx-signature-ed25519` — base64. */
  readonly signatureEd25519: string | null;
}

/**
 * Decodifica a chave pública de webhook (base64, 32 bytes crus — formato
 * publicado no portal da Telnyx) pra um `KeyObject` Ed25519 utilizável por
 * `crypto.verify`. A ida-e-volta canônica (`raw.toString("base64") ===
 * input`) evita aceitar lixo que só "parece" base64 — mesma disciplina de
 * `apps/portal/src/lib/meetings/webhook.ts` `parseRecallWebhookSecret`.
 */
export function parseTelnyxWebhookPublicKey(base64PublicKey: string): KeyObject | null {
  if (typeof base64PublicKey !== "string" || base64PublicKey.trim().length === 0) return null;
  let raw: Buffer;
  try {
    raw = Buffer.from(base64PublicKey, "base64");
  } catch {
    return null;
  }
  // Chaves públicas Ed25519 cruas têm sempre 32 bytes (RFC 8032).
  if (raw.length !== 32 || raw.toString("base64") !== base64PublicKey) return null;
  const base64Url = base64PublicKey.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  try {
    return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: base64Url }, format: "jwk" });
  } catch {
    return null;
  }
}

/**
 * Verifica a assinatura Ed25519 de um webhook Telnyx: `${timestamp}|${rawBody}`
 * assinado com a chave privada de webhook da conta, verificado aqui contra a
 * chave PÚBLICA correspondente. Diferente de HMAC (Recall.ai/Stripe neste
 * repo), a verificação de assinatura assimétrica do `crypto.verify` do Node
 * já é a "comparação em tempo constante" exigida — não há segredo
 * compartilhado pra comparar byte a byte, é uma verificação de assinatura
 * pública. Timestamp fora de ±5min é rejeitado (proteção contra replay).
 */
export function verifyTelnyxWebhookSignature(
  publicKeyBase64: string,
  headers: TelnyxWebhookSignatureHeaders,
  rawBody: string,
  nowSeconds: number,
): boolean {
  const { timestamp, signatureEd25519 } = headers;
  if (timestamp === null || signatureEd25519 === null) return false;
  if (timestamp.length === 0 || signatureEd25519.length === 0) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || !Number.isInteger(timestampSeconds)) return false;
  if (Math.abs(nowSeconds - timestampSeconds) > WEBHOOK_SIGNATURE_TOLERANCE_SECONDS) return false;

  const publicKey = parseTelnyxWebhookPublicKey(publicKeyBase64);
  if (publicKey === null) return false;

  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(signatureEd25519, "base64");
  } catch {
    return false;
  }
  // Assinaturas Ed25519 têm sempre 64 bytes (RFC 8032).
  if (signatureBytes.length !== 64) return false;

  const signedMessage = Buffer.from(`${timestamp}|${rawBody}`, "utf8");
  try {
    return verify(null, signedMessage, publicKey, signatureBytes);
  } catch {
    return false;
  }
}

const CALL_WEBHOOK_EVENT_TYPES = new Set(["call.initiated", "call.answered", "call.hangup"]);
export type TelnyxCallWebhookEventType = "call.initiated" | "call.answered" | "call.hangup";

export interface TelnyxCallWebhookEvent {
  readonly eventType: TelnyxCallWebhookEventType;
  readonly callControlId: string;
  readonly callSessionId: string;
  /** Só presente em `call.hangup` (doc: enum fechado — call_rejected, normal_clearing, originator_cancel, timeout, time_limit, user_busy, not_found, no_answer, unspecified). */
  readonly hangupCause?: string;
}

/** Corpo já parseado como JSON (`JSON.parse` do raw body) — verifique a assinatura ANTES de chamar isto. */
export function parseTelnyxCallWebhookEvent(rawBody: unknown): TelnyxCallWebhookEvent | null {
  if (rawBody === null || typeof rawBody !== "object") return null;
  const data = (rawBody as Record<string, unknown>).data;
  if (data === null || typeof data !== "object") return null;
  const dataRecord = data as Record<string, unknown>;
  const eventType = dataRecord.event_type;
  if (typeof eventType !== "string" || !CALL_WEBHOOK_EVENT_TYPES.has(eventType)) return null;
  const payload = dataRecord.payload;
  if (payload === null || typeof payload !== "object") return null;
  const payloadRecord = payload as Record<string, unknown>;
  const callControlId = payloadRecord.call_control_id;
  const callSessionId = payloadRecord.call_session_id;
  if (typeof callControlId !== "string" || callControlId.length === 0) return null;
  if (typeof callSessionId !== "string" || callSessionId.length === 0) return null;
  const hangupCause = payloadRecord.hangup_cause;
  return Object.freeze({
    eventType: eventType as TelnyxCallWebhookEventType,
    callControlId,
    callSessionId,
    ...(typeof hangupCause === "string" ? { hangupCause } : {}),
  });
}

const MESSAGE_WEBHOOK_EVENT_TYPES = new Set(["message.sent", "message.finalized"]);
export type TelnyxMessageWebhookEventType = "message.sent" | "message.finalized";

export interface TelnyxMessageWebhookEvent {
  readonly eventType: TelnyxMessageWebhookEventType;
  readonly messageId: string;
  readonly status: TelnyxMessageDeliveryStatus | null;
}

/** Corpo já parseado como JSON — verifique a assinatura ANTES de chamar isto. */
export function parseTelnyxMessageWebhookEvent(rawBody: unknown): TelnyxMessageWebhookEvent | null {
  if (rawBody === null || typeof rawBody !== "object") return null;
  const data = (rawBody as Record<string, unknown>).data;
  if (data === null || typeof data !== "object") return null;
  const dataRecord = data as Record<string, unknown>;
  const eventType = dataRecord.event_type;
  if (typeof eventType !== "string" || !MESSAGE_WEBHOOK_EVENT_TYPES.has(eventType)) return null;
  const payload = dataRecord.payload;
  if (payload === null || typeof payload !== "object") return null;
  const payloadRecord = payload as Record<string, unknown>;
  const messageId = payloadRecord.id;
  if (typeof messageId !== "string" || messageId.length === 0) return null;
  const toList = payloadRecord.to;
  let status: TelnyxMessageDeliveryStatus | null = null;
  if (Array.isArray(toList) && toList.length > 0) {
    const first = (toList[0] ?? {}) as Record<string, unknown>;
    if (typeof first.status === "string" && MESSAGE_STATUSES.has(first.status as TelnyxMessageDeliveryStatus)) {
      status = first.status as TelnyxMessageDeliveryStatus;
    }
  }
  return Object.freeze({ eventType: eventType as TelnyxMessageWebhookEventType, messageId, status });
}
