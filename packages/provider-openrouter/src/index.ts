/**
 * Primeiro adapter de provider REAL do projeto (ADR-033, D-V2-064).
 *
 * Escopo deliberadamente estreito: geração de texto request/response para o
 * chat de teste de agente do portal (control-plane). O pipeline realtime de
 * voz/avatar de M2 continua fake-first atrás dos contratos congelados de
 * `@axtro/provider-contracts` (`providerMode: "fake"`) até o bake-off
 * credenciado (D-V2-048) — este pacote não toca aqueles ports.
 *
 * Guardrails estruturais:
 * - egress fixo em https://openrouter.ai (o chamador não escolhe URL);
 * - a chave nunca aparece em erros, logs ou no objeto de resultado;
 * - limites fechados de mensagens, tamanho e max_tokens;
 * - timeout obrigatório com AbortController;
 * - fetch injetável: os testes cobrem o adapter sem rede.
 */

export interface TextGenerationMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface TextGenerationRequest {
  readonly model: string;
  readonly messages: readonly TextGenerationMessage[];
  readonly maxOutputTokens: number;
}

export interface TextGenerationUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface TextGenerationResult {
  readonly text: string;
  readonly model: string;
  readonly usage: TextGenerationUsage;
}

export type TextGenerationErrorCode =
  | "missing_api_key"
  | "invalid_request"
  | "provider_rejected"
  | "provider_timeout"
  | "provider_unavailable"
  | "malformed_provider_response";

export class TextGenerationError extends Error {
  readonly code: TextGenerationErrorCode;

  constructor(code: TextGenerationErrorCode, message: string) {
    super(message);
    this.name = "TextGenerationError";
    this.code = code;
  }
}

/** Port mínimo de geração de texto do control-plane (ADR-033). */
export interface TextGenerationPort {
  readonly providerId: string;
  generate(request: TextGenerationRequest): Promise<TextGenerationResult>;
}

export interface OpenRouterAdapterOptions {
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch;
  /** Identificação de app enviada ao OpenRouter (headers de atribuição). */
  readonly appUrl?: string;
  readonly appTitle?: string;
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 4000;
const MAX_OUTPUT_TOKENS_CAP = 1024;
const MODEL_PATTERN = /^[a-z0-9][a-z0-9._\/:-]{2,127}$/i;
const DEFAULT_TIMEOUT_MS = 30_000;

export function createOpenRouterTextGenerationPort(options: OpenRouterAdapterOptions): TextGenerationPort {
  const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  if (apiKey.length < 8) {
    throw new TextGenerationError("missing_api_key", "OpenRouter API key is not configured");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImplementation = options.fetchImplementation ?? fetch;

  return Object.freeze({
    providerId: "openrouter",
    async generate(request: TextGenerationRequest): Promise<TextGenerationResult> {
      validateRequest(request);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetchImplementation(ENDPOINT, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            ...(options.appUrl ? { "HTTP-Referer": options.appUrl } : {}),
            ...(options.appTitle ? { "X-Title": options.appTitle } : {}),
          },
          body: JSON.stringify({
            model: request.model,
            messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
            max_tokens: request.maxOutputTokens,
          }),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new TextGenerationError("provider_timeout", `OpenRouter timed out after ${timeoutMs}ms`);
        }
        throw new TextGenerationError("provider_unavailable", "OpenRouter request failed before a response");
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        // Corpo de erro nunca é repassado cru: pode ecoar headers/entrada.
        const code: TextGenerationErrorCode = response.status >= 500 ? "provider_unavailable" : "provider_rejected";
        throw new TextGenerationError(code, `OpenRouter respondeu HTTP ${response.status}`);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new TextGenerationError("malformed_provider_response", "OpenRouter returned non-JSON output");
      }
      return parseCompletion(payload);
    },
  });
}

function validateRequest(request: TextGenerationRequest): void {
  if (typeof request.model !== "string" || !MODEL_PATTERN.test(request.model)) {
    throw new TextGenerationError("invalid_request", "model must be a plain OpenRouter model id");
  }
  if (!Array.isArray(request.messages) || request.messages.length === 0 || request.messages.length > MAX_MESSAGES) {
    throw new TextGenerationError("invalid_request", `messages must contain 1..${MAX_MESSAGES} entries`);
  }
  for (const message of request.messages) {
    if (message.role !== "system" && message.role !== "user" && message.role !== "assistant") {
      throw new TextGenerationError("invalid_request", "message role must be system, user or assistant");
    }
    if (typeof message.content !== "string" || message.content.length === 0 || message.content.length > MAX_MESSAGE_CHARS) {
      throw new TextGenerationError("invalid_request", `message content must be 1..${MAX_MESSAGE_CHARS} chars`);
    }
  }
  if (
    !Number.isInteger(request.maxOutputTokens)
    || request.maxOutputTokens < 1
    || request.maxOutputTokens > MAX_OUTPUT_TOKENS_CAP
  ) {
    throw new TextGenerationError("invalid_request", `maxOutputTokens must be 1..${MAX_OUTPUT_TOKENS_CAP}`);
  }
}

function parseCompletion(payload: unknown): TextGenerationResult {
  if (payload === null || typeof payload !== "object") {
    throw new TextGenerationError("malformed_provider_response", "completion payload is not an object");
  }
  const record = payload as Record<string, unknown>;
  const choices = record.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new TextGenerationError("malformed_provider_response", "completion payload has no choices");
  }
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = (first?.message ?? null) as Record<string, unknown> | null;
  const text = message?.content;
  if (typeof text !== "string" || text.length === 0) {
    throw new TextGenerationError("malformed_provider_response", "completion payload has no text content");
  }
  const usageRecord = (record.usage ?? {}) as Record<string, unknown>;
  const inputTokens = normalizeTokenCount(usageRecord.prompt_tokens);
  const outputTokens = normalizeTokenCount(usageRecord.completion_tokens);
  const model = typeof record.model === "string" && record.model.length > 0 ? record.model : "openrouter/unknown";

  return Object.freeze({
    text,
    model,
    usage: Object.freeze({ inputTokens, outputTokens }),
  });
}

function normalizeTokenCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}
