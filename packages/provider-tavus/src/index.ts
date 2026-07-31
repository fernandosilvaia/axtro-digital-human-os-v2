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
  constructor(code: VideoProviderErrorCode, message: string) {
    super(message);
    this.name = "VideoProviderError";
    this.code = code;
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
const MAX_CONTEXT_CHARS = 6000;
const MAX_GREETING_CHARS = 400;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_CALL_SECONDS_CAP = 1800;

export function createTavusVideoConversationPort(options: TavusAdapterOptions): VideoConversationPort {
  const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  if (apiKey.length < 8) throw new VideoProviderError("missing_api_key", "Tavus API key is not configured");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImplementation = options.fetchImplementation ?? fetch;

  async function call(path: string, body: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImplementation(`${BASE}${path}`, {
        method: "POST",
        signal: controller.signal,
        headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new VideoProviderError("provider_timeout", `Tavus timed out after ${timeoutMs}ms`);
      }
      throw new VideoProviderError("provider_unavailable", "Tavus request failed before a response");
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const code: VideoProviderErrorCode = response.status >= 500 ? "provider_unavailable" : "provider_rejected";
      throw new VideoProviderError(code, `Tavus respondeu HTTP ${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new VideoProviderError("malformed_provider_response", "Tavus returned non-JSON output");
    }
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

      const payload = await call("/conversations", {
        ...(usePersona ? { persona_id: request.personaId } : { replica_id: request.replicaId }),
        conversation_name: request.conversationName,
        ...(request.conversationalContext ? { conversational_context: request.conversationalContext } : {}),
        ...(request.greeting ? { custom_greeting: request.greeting } : {}),
        properties: {
          max_call_duration: maxSeconds,
          participant_left_timeout: 30,
          ...(request.language ? { language: request.language } : {}),
        },
      });
      const record = (payload ?? {}) as Record<string, unknown>;
      const conversationId = record.conversation_id;
      const conversationUrl = record.conversation_url;
      if (typeof conversationId !== "string" || typeof conversationUrl !== "string"
        || !conversationUrl.startsWith("https://")) {
        throw new VideoProviderError("malformed_provider_response", "Tavus conversation payload is incomplete");
      }
      return Object.freeze({ conversationId, conversationUrl });
    },
    async endConversation(conversationId: string): Promise<void> {
      if (!ID_PATTERN.test(conversationId)) {
        throw new VideoProviderError("invalid_request", "conversationId must be a plain Tavus conversation id");
      }
      await call(`/conversations/${conversationId}/end`, {});
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
