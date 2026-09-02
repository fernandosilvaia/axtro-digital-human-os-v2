/**
 * Segundo adapter de provider real (ADR-034): Tavus CVI — conversa em VÍDEO
 * com avatar humanizado. Mesmos guardrails do adapter OpenRouter: egress fixo,
 * fetch injetável, chave nunca vaza, caps fechados, timeout obrigatório.
 * Os ports realtime fake de M0-M2 continuam intocados; este é o caminho de
 * vídeo do control-plane até o bake-off formal.
 */

export interface VideoConversationRequest {
  /** Modo réplica: rosto stock + contexto por chamada (voz padrão da réplica). */
  readonly replicaId?: string;
  /** Modo persona: bundle pronto no Tavus (voz, percepção, interrupção, prompt). */
  readonly personaId?: string;
  readonly conversationName: string;
  readonly conversationalContext?: string;
  readonly greeting?: string;
  readonly language?: string;
  readonly maxCallDurationSeconds?: number;
  /**
   * URL que recebe os callbacks da conversa (docs.tavus.io/sections/
   * webhooks-and-callbacks) — usado pra capturar o transcript quando a
   * call termina (evento `application.transcription_ready`). Sem
   * assinatura/HMAC nesses callbacks (confirmado na doc — Tavus não
   * assina); a rota que recebe precisa da própria camada de autenticação
   * (token na URL, mesmo padrão do webhook do Recall.ai).
   */
  readonly callbackUrl?: string;
}

export interface VideoConversation {
  readonly conversationId: string;
  readonly conversationUrl: string;
}

export type VideoProviderErrorCode =
  | "missing_api_key"
  | "invalid_request"
  | "provider_rejected"
  | "provider_timeout"
  | "provider_unavailable"
  | "malformed_provider_response";

export class VideoProviderError extends Error {
  readonly code: VideoProviderErrorCode;
  /** Provider HTTP status when a response was received; absent for local/network failures. */
  readonly httpStatus: number | null;
  constructor(code: VideoProviderErrorCode, message: string, httpStatus: number | null = null) {
    super(message);
    this.name = "VideoProviderError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * Criação de persona (auto-provisão de vídeo para agentes de clientes novos):
 * a persona carrega prompt, voz, percepção e modelo no provider — criar uma
 * por agente é o que dá vídeo a QUALQUER tenant, não só aos agentes demo
 * configurados à mão.
 */
export interface CreatePersonaRequest {
  readonly personaName: string;
  readonly systemPrompt: string;
  readonly defaultReplicaId: string;
  readonly llmModel?: string;
  readonly ambientAwarenessQueries?: readonly string[];
  /** Voz ElevenLabs opcional; ausente = voz default do provider. */
  readonly elevenLabs?: { readonly apiKey: string; readonly voiceId: string };
}

export interface CreatedPersona {
  readonly personaId: string;
}

export interface VideoConversationPort {
  readonly providerId: string;
  createConversation(request: VideoConversationRequest): Promise<VideoConversation>;
  endConversation(conversationId: string): Promise<void>;
  createPersona(request: CreatePersonaRequest): Promise<CreatedPersona>;
  /** Anexa tools já registradas na conta (ex.: controles de slide) à persona. */
  attachToolsToPersona(personaId: string, toolIds: readonly string[]): Promise<void>;
}

export interface TavusAdapterOptions {
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch;
}

const BASE = "https://tavusapi.com/v2";
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,64}$/i;
/**
 * Shape of every Tavus id (persona, replica, conversation, tool) as accepted
 * by this adapter. Exported so callers outside the adapter (e.g. the
 * transcript webhook) validate a conversationId with the exact same pattern
 * instead of hand-duplicating a copy that can silently drift out of sync.
 */
export const TAVUS_CONVERSATION_ID_PATTERN = ID_PATTERN;
const MAX_CONTEXT_CHARS = 6000;
const MAX_GREETING_CHARS = 400;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_CALL_SECONDS_CAP = 1800;
const TAVUS_CONVERSATION_ORIGIN = "https://tavus.daily.co";
const MAX_CONVERSATION_URL_CHARS = 2048;

/**
 * Tavus currently returns Daily rooms on its dedicated, provider-owned
 * origin. Keep this allowlist deliberately exact: accepting arbitrary
 * `*.daily.co` hosts would allow an untrusted tenant/customer Daily domain,
 * while a generic HTTPS check would turn the returned iframe URL into an
 * origin-injection boundary.
 *
 * The raw authority is checked before URL normalization so explicit ports
 * (including `:443`) and userinfo cannot be hidden by WHATWG URL parsing.
 * This pure helper is also used by browser consumers before iframe/Daily join.
 */
export function isTrustedTavusConversationUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_CONVERSATION_URL_CHARS || value.trim() !== value) {
    return false;
  }
  if (/[\\\u0000-\u001f\u007f]/.test(value) || value.includes("#")) return false;

  const schemePrefix = "https://";
  if (!value.toLowerCase().startsWith(schemePrefix)) return false;
  const remainder = value.slice(schemePrefix.length);
  const authorityEnd = remainder.search(/[/?#]/u);
  const authority = remainder.slice(0, authorityEnd === -1 ? undefined : authorityEnd);
  if (authority.toLowerCase() !== "tavus.daily.co") return false;

  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && parsed.origin === TAVUS_CONVERSATION_ORIGIN
      && parsed.hostname === "tavus.daily.co"
      && parsed.username === ""
      && parsed.password === ""
      && parsed.port === ""
      && parsed.pathname.length > 1;
  } catch {
    return false;
  }
}

/**
 * Núcleo HTTP compartilhado por createTavusVideoConversationPort (sempre
 * POST) e pelas funções de provisão de tool abaixo (GET e POST) --
 * extraído sem mudar nenhum comportamento observável dos call sites
 * existentes (mesmo timeout-sobrevive-ao-corpo, mesmo mapeamento de erro).
 * `conflictIsNull` espelha `notFoundIsSuccess`: um 409 (nome de tool já
 * existe na conta, confirmado na doc real do Tavus,
 * docs.tavus.io/api-reference/tools/create-tool) vira `null` em vez de
 * lançar, pro chamador decidir o que "já existe" significa pro seu caso —
 * nunca se aplica à criação/mutação de conversa ou persona, só quando o
 * chamador pede explicitamente.
 */
async function tavusRequest(
  apiKey: string,
  timeoutMs: number,
  fetchImplementation: typeof fetch,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
  requestOptions: Readonly<{ notFoundIsSuccess?: boolean; conflictIsNull?: boolean }> = {},
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImplementation(`${BASE}${path}`, {
      method,
      signal: controller.signal,
      headers: method === "GET"
        ? { "x-api-key": apiKey }
        : { "x-api-key": apiKey, "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof Error && error.name === "AbortError") {
      throw new VideoProviderError("provider_timeout", `Tavus timed out after ${timeoutMs}ms`);
    }
    throw new VideoProviderError("provider_unavailable", "Tavus request failed before a response");
  }
  // O timer segue vivo até o CORPO ser consumido — headers rápidos com body
  // pendurado não podem escapar do timeout (auditoria 2026-08-02).
  try {
    if (!response.ok) {
      // Encerramento é idempotente: uma conversa que o provider já não
      // encontra não pode permanecer para sempre em cleanup_pending. Esta
      // exceção é opt-in e nunca se aplica à criação ou mutação comum.
      if (response.status === 404 && requestOptions.notFoundIsSuccess === true) return null;
      if (response.status === 409 && requestOptions.conflictIsNull === true) return null;
      const code: VideoProviderErrorCode = response.status >= 500 ? "provider_unavailable" : "provider_rejected";
      throw new VideoProviderError(code, `Tavus respondeu HTTP ${response.status}`, response.status);
    }
    // 204/corpo vazio é sucesso (caso real do POST /conversations/{id}/end) —
    // exigir JSON aqui transformava operação bem-sucedida em erro.
    if (response.status === 204) return null;
    const text = await response.text();
    if (text.length === 0) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new VideoProviderError("malformed_provider_response", "Tavus returned non-JSON output");
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new VideoProviderError("provider_timeout", `Tavus timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function createTavusVideoConversationPort(options: TavusAdapterOptions): VideoConversationPort {
  const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  if (apiKey.length < 8) throw new VideoProviderError("missing_api_key", "Tavus API key is not configured");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImplementation = options.fetchImplementation ?? fetch;

  function call(
    path: string,
    body: Record<string, unknown>,
    callOptions: Readonly<{ notFoundIsSuccess?: boolean }> = {},
  ): Promise<unknown> {
    return tavusRequest(apiKey, timeoutMs, fetchImplementation, "POST", path, body, callOptions);
  }

  return Object.freeze({
    providerId: "tavus",
    async createConversation(request: VideoConversationRequest): Promise<VideoConversation> {
      const usePersona = request.personaId !== undefined;
      if (usePersona) {
        if (!ID_PATTERN.test(request.personaId!)) {
          throw new VideoProviderError("invalid_request", "personaId must be a plain Tavus persona id");
        }
      } else if (!ID_PATTERN.test(request.replicaId ?? "")) {
        throw new VideoProviderError("invalid_request", "replicaId or personaId is required");
      }
      if (typeof request.conversationName !== "string" || request.conversationName.length === 0 || request.conversationName.length > 120) {
        throw new VideoProviderError("invalid_request", "conversationName must be 1..120 chars");
      }
      // Contexto é obrigatório no modo réplica; opcional no modo persona (a persona já carrega o prompt).
      if (!usePersona && (typeof request.conversationalContext !== "string"
        || request.conversationalContext.length === 0
        || request.conversationalContext.length > MAX_CONTEXT_CHARS)) {
        throw new VideoProviderError("invalid_request", `conversationalContext must be 1..${MAX_CONTEXT_CHARS} chars`);
      }
      if (request.conversationalContext !== undefined && request.conversationalContext.length > MAX_CONTEXT_CHARS) {
        throw new VideoProviderError("invalid_request", `conversationalContext must be at most ${MAX_CONTEXT_CHARS} chars`);
      }
      if (request.greeting !== undefined && (request.greeting.length === 0 || request.greeting.length > MAX_GREETING_CHARS)) {
        throw new VideoProviderError("invalid_request", `greeting must be 1..${MAX_GREETING_CHARS} chars`);
      }
      const maxSeconds = request.maxCallDurationSeconds ?? 600;
      if (!Number.isInteger(maxSeconds) || maxSeconds < 60 || maxSeconds > MAX_CALL_SECONDS_CAP) {
        throw new VideoProviderError("invalid_request", `maxCallDurationSeconds must be 60..${MAX_CALL_SECONDS_CAP}`);
      }
      if (request.callbackUrl !== undefined && !request.callbackUrl.startsWith("https://")) {
        throw new VideoProviderError("invalid_request", "callbackUrl must be an https URL");
      }

      const payload = await call("/conversations", {
        ...(usePersona ? { persona_id: request.personaId } : { replica_id: request.replicaId }),
        conversation_name: request.conversationName,
        ...(request.conversationalContext ? { conversational_context: request.conversationalContext } : {}),
        ...(request.greeting ? { custom_greeting: request.greeting } : {}),
        ...(request.callbackUrl ? { callback_url: request.callbackUrl } : {}),
        properties: {
          max_call_duration: maxSeconds,
          participant_left_timeout: 30,
          ...(request.language ? { language: request.language } : {}),
        },
      });
      const record = (payload ?? {}) as Record<string, unknown>;
      const conversationId = record.conversation_id;
      const conversationUrl = record.conversation_url;
      if (typeof conversationId !== "string" || !ID_PATTERN.test(conversationId) || typeof conversationUrl !== "string"
        || !isTrustedTavusConversationUrl(conversationUrl)) {
        throw new VideoProviderError("malformed_provider_response", "Tavus conversation payload is incomplete");
      }
      return Object.freeze({ conversationId, conversationUrl });
    },
    async endConversation(conversationId: string): Promise<void> {
      if (!ID_PATTERN.test(conversationId)) {
        throw new VideoProviderError("invalid_request", "conversationId must be a plain Tavus conversation id");
      }
      await call(`/conversations/${conversationId}/end`, {}, { notFoundIsSuccess: true });
    },
    async createPersona(request: CreatePersonaRequest): Promise<CreatedPersona> {
      if (typeof request.personaName !== "string" || request.personaName.length === 0 || request.personaName.length > 120) {
        throw new VideoProviderError("invalid_request", "personaName must be 1..120 chars");
      }
      if (typeof request.systemPrompt !== "string" || request.systemPrompt.length === 0 || request.systemPrompt.length > 20_000) {
        throw new VideoProviderError("invalid_request", "systemPrompt must be 1..20000 chars");
      }
      if (!ID_PATTERN.test(request.defaultReplicaId)) {
        throw new VideoProviderError("invalid_request", "defaultReplicaId must be a plain Tavus replica id");
      }
      if (request.ambientAwarenessQueries !== undefined && request.ambientAwarenessQueries.length > 12) {
        throw new VideoProviderError("invalid_request", "ambientAwarenessQueries must have at most 12 entries");
      }

      const payload = await call("/personas", {
        persona_name: request.personaName,
        pipeline_mode: "full",
        default_replica_id: request.defaultReplicaId,
        system_prompt: request.systemPrompt,
        layers: {
          llm: { model: request.llmModel ?? "tavus-gemma-4" },
          stt: {
            stt_engine: "tavus-advanced",
            participant_pause_sensitivity: "high",
            participant_interrupt_sensitivity: "high",
            smart_turn_detection: true,
          },
          perception: {
            perception_model: "raven-1",
            ambient_awareness_queries: request.ambientAwarenessQueries ?? [],
          },
          ...(request.elevenLabs
            ? {
                tts: {
                  tts_engine: "elevenlabs",
                  api_key: request.elevenLabs.apiKey,
                  external_voice_id: request.elevenLabs.voiceId,
                  tts_model_name: "eleven_turbo_v2_5",
                  tts_emotion_control: true,
                },
              }
            : {}),
        },
      });
      const record = (payload ?? {}) as Record<string, unknown>;
      const personaId = record.persona_id;
      if (typeof personaId !== "string" || !ID_PATTERN.test(personaId)) {
        throw new VideoProviderError("malformed_provider_response", "Tavus persona payload has no persona_id");
      }
      return Object.freeze({ personaId });
    },
    async attachToolsToPersona(personaId: string, toolIds: readonly string[]): Promise<void> {
      if (!ID_PATTERN.test(personaId)) {
        throw new VideoProviderError("invalid_request", "personaId must be a plain Tavus persona id");
      }
      if (!Array.isArray(toolIds) || toolIds.length === 0 || toolIds.length > 16 || toolIds.some((id) => !ID_PATTERN.test(id))) {
        throw new VideoProviderError("invalid_request", "toolIds must be 1..16 plain Tavus tool ids");
      }
      await call(`/pals/${personaId}/tools`, { tool_ids: toolIds });
    },
  });
}

/**
 * Provisão de tool na conta (ADR-041, "Registro real das tools no Tavus").
 * Deliberadamente FORA de VideoConversationPort: criar/listar tool é uma
 * operação de configuração de CONTA (afeta toda persona futura que a
 * anexar), nunca de runtime por chamada/sessão/tenant -- a mesma invariante
 * que tests/portal/m5-01-integrity.test.mjs já impõe para
 * attachToolsToPersona (nunca chamada de dentro de apps/portal) se estende
 * às duas funções abaixo pelo mesmo motivo. O único chamador pretendido é
 * scripts/provision-tavus-business-tools.mjs, rodado manualmente contra
 * TAVUS_API_KEY de um ambiente, no mesmo espírito de um script de migration.
 */
const TAVUS_TOOL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** Confirmado contra a doc real do Tavus (docs.tavus.io/api-reference/tools/create-tool): description + parameters serializados juntos não podem passar de 10000 chars; este teto cobre só o campo description isolado, generoso o bastante pras 3 tools de negócio (a maior tem ~140 chars) sem se aproximar do teto real combinado. */
const MAX_TOOL_DESCRIPTION_CHARS = 2000;

export interface TavusToolParameterSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
}

export interface TavusToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: TavusToolParameterSchema;
}

/**
 * Confirmado contra a doc real do Tavus: "silent"/"generate_filler"/
 * "static_filler"/"passthrough" pra on_call, "add_to_context"/
 * "generate_response"/"response_in_result"/"fire_and_forget" pra
 * on_resolve. As 3 tools de negócio (ADR-041) sempre usam
 * on_call:"silent"/on_resolve:"add_to_context" -- mesmo trio que D-V2-074
 * já registra, com prova de produção, para next_slide/previous_slide/
 * go_to_slide -- mas o tipo aceita qualquer combinação válida porque nada
 * aqui é específico de negócio.
 */
export interface TavusToolBehavior {
  readonly onCall: "silent" | "generate_filler" | "static_filler" | "passthrough";
  readonly onResolve: "add_to_context" | "generate_response" | "response_in_result" | "fire_and_forget";
}

export interface TavusRegisteredTool {
  readonly toolId: string;
  readonly name: string;
}

export type CreateTavusToolResult =
  | Readonly<{ readonly outcome: "created"; readonly tool: TavusRegisteredTool }>
  /** 409 real do Tavus (nome já existe na conta) -- nunca um erro, o chamador relista pra achar o toolId existente. */
  | Readonly<{ readonly outcome: "already_exists" }>;

function parseTavusToolListPayload(payload: unknown): readonly TavusRegisteredTool[] {
  const record = (payload ?? {}) as Record<string, unknown>;
  const data = record.data;
  if (!Array.isArray(data)) throw new VideoProviderError("malformed_provider_response", "Tavus tools list payload has no data array");
  return Object.freeze(data.map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    if (typeof item.tool_id !== "string" || !ID_PATTERN.test(item.tool_id) || typeof item.name !== "string") {
      throw new VideoProviderError("malformed_provider_response", "Tavus tools list entry is incomplete");
    }
    return Object.freeze({ toolId: item.tool_id, name: item.name });
  }));
}

/**
 * GET /v2/tools -- lista tools de tipo "user" (nunca as tools de sistema
 * como end_call, que não podem ser criadas/atualizadas). `nameOrUuid` é
 * substring case-insensitive do lado do Tavus (confirmado na doc real) --
 * este helper nunca assume que um match parcial é o mesmo nome; o chamador
 * (findTavusToolByExactName abaixo) sempre filtra por igualdade exata antes
 * de decidir que uma tool "já existe".
 */
export async function listTavusTools(
  options: TavusAdapterOptions,
  filter: Readonly<{ nameOrUuid?: string }> = {},
): Promise<readonly TavusRegisteredTool[]> {
  const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  if (apiKey.length < 8) throw new VideoProviderError("missing_api_key", "Tavus API key is not configured");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const query = new URLSearchParams({ type: "user", limit: "100" });
  if (filter.nameOrUuid !== undefined) query.set("name_or_uuid", filter.nameOrUuid);
  const payload = await tavusRequest(apiKey, timeoutMs, fetchImplementation, "GET", `/tools?${query.toString()}`);
  return parseTavusToolListPayload(payload);
}

/** Busca uma tool pelo nome EXATO (nunca substring) já cadastrada na conta, ou `null` se nenhuma bater. */
export async function findTavusToolByExactName(options: TavusAdapterOptions, name: string): Promise<TavusRegisteredTool | null> {
  const candidates = await listTavusTools(options, { nameOrUuid: name });
  return candidates.find((tool) => tool.name === name) ?? null;
}

/**
 * POST /v2/tools. `delivery: {app_message: true}` é o único canal que este
 * repositório usa (o data channel do Daily, nunca o webhook `delivery.api`
 * do Tavus); `trigger_type: "in_call"`/`origin: "llm"` (defaults do próprio
 * Tavus) são corretos pras 3 tools de negócio, sempre chamadas pelo LLM
 * durante a conversa, nunca post-call nem por percepção. Um 409 (nome já
 * existe) vira `{outcome:"already_exists"}`, nunca uma exceção -- rodar
 * este script duas vezes contra a mesma conta é seguro por design (mesmo
 * espírito idempotente de um script de migration).
 */
export async function createTavusTool(
  options: TavusAdapterOptions,
  tool: TavusToolDefinition,
  behavior: TavusToolBehavior,
): Promise<CreateTavusToolResult> {
  const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  if (apiKey.length < 8) throw new VideoProviderError("missing_api_key", "Tavus API key is not configured");
  if (typeof tool.name !== "string" || !TAVUS_TOOL_NAME_PATTERN.test(tool.name)) {
    throw new VideoProviderError("invalid_request", "tool name must match Tavus function-naming rules (letters/digits/underscores, max 64 chars)");
  }
  if (typeof tool.description !== "string" || tool.description.length === 0 || tool.description.length > MAX_TOOL_DESCRIPTION_CHARS) {
    throw new VideoProviderError("invalid_request", `tool description must be 1..${MAX_TOOL_DESCRIPTION_CHARS} chars`);
  }
  if (tool.parameters?.type !== "object" || typeof tool.parameters.properties !== "object" || tool.parameters.properties === null) {
    throw new VideoProviderError("invalid_request", "tool parameters must be a JSON Schema object with a properties map");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const payload = await tavusRequest(apiKey, timeoutMs, fetchImplementation, "POST", "/tools", {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    delivery: { app_message: true },
    trigger_type: "in_call",
    origin: "llm",
    on_call: behavior.onCall,
    on_resolve: behavior.onResolve,
  }, { conflictIsNull: true });
  if (payload === null) return Object.freeze({ outcome: "already_exists" });
  const record = (payload ?? {}) as Record<string, unknown>;
  if (typeof record.tool_id !== "string" || !ID_PATTERN.test(record.tool_id) || record.name !== tool.name) {
    throw new VideoProviderError("malformed_provider_response", "Tavus create-tool payload is incomplete");
  }
  return Object.freeze({ outcome: "created", tool: Object.freeze({ toolId: record.tool_id, name: record.name }) });
}
