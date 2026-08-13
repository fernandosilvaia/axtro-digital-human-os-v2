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
  /**
   * Custo faturado em USD reportado pelo próprio OpenRouter (usage.cost,
   * pedido via `usage: {include: true}` no request). Ausente quando o
   * provider não reporta — o caller decide se estima por tabela.
   */
  readonly reportedCostUsd?: number;
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
const RATE_LIMIT_RETRY_DELAY_MS = 400;
const MAX_RATE_LIMIT_RETRY_DELAY_MS = 2000;

interface RateLimitRetryAttempt {
  readonly response: Response;
  readonly clearTimer: () => void;
}

/**
 * Uma única retentativa em HTTP 429 antes de desistir (achado onda 7,
 * D-V2-116): sem isto, uma contenção momentânea de capacidade compartilhada
 * no OpenRouter (rate limit é por definição transitório, ao contrário de um
 * 400/422 permanente) derrubava a chamada inteira na primeira resposta —
 * abortando um lote de embedding de conhecimento sem salvar nada, ou
 * devolvendo a fala de fallback genérica no meio de uma geração de texto.
 * O timer de timeout é recriado por tentativa e segue vivo até o corpo da
 * resposta MANTIDA ser consumido pelo chamador (disciplina de D-V2-109).
 */
async function fetchWithRateLimitRetry(
  fetchImplementation: typeof fetch,
  url: string,
  init: { readonly method: string; readonly headers: Record<string, string>; readonly body: string },
  timeoutMs: number,
  providerLabel: string,
): Promise<RateLimitRetryAttempt> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImplementation(url, { ...init, signal: controller.signal });
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof Error && error.name === "AbortError") {
        throw new TextGenerationError("provider_timeout", `${providerLabel} timed out after ${timeoutMs}ms`);
      }
      throw new TextGenerationError("provider_unavailable", `${providerLabel} request failed before a response`);
    }
    if (response.status === 429 && attempt === 1) {
      clearTimeout(timer);
      await sleep(rateLimitRetryDelayMs(response.headers.get("retry-after")));
      continue;
    }
    return { response, clearTimer: () => clearTimeout(timer) };
  }
  // Inatingível — o loop de 2 tentativas sempre retorna ou lança acima.
  throw new TextGenerationError("provider_unavailable", `${providerLabel} request failed`);
}

function rateLimitRetryDelayMs(retryAfterHeader: string | null): number {
  const parsed = retryAfterHeader !== null ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0) {
    return Math.min(parsed * 1000, MAX_RATE_LIMIT_RETRY_DELAY_MS);
  }
  return RATE_LIMIT_RETRY_DELAY_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

      const { response, clearTimer } = await fetchWithRateLimitRetry(
        fetchImplementation,
        ENDPOINT,
        {
          method: "POST",
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
            // Pede o custo faturado real na resposta (usage.cost) — evita
            // dupla manutenção de preço de tabela no SQL pro caminho de chat
            // e cobre qualquer OPENROUTER_MODEL configurado (0027).
            usage: { include: true },
          }),
        },
        timeoutMs,
        "OpenRouter",
      );

      // O timer segue vivo até o corpo ser consumido — headers rápidos com
      // body pendurado não escapam do timeout (auditoria 2026-08-02).
      try {
        if (!response.ok) {
          // Corpo de erro nunca é repassado cru: pode ecoar headers/entrada.
          const code: TextGenerationErrorCode = response.status >= 500 ? "provider_unavailable" : "provider_rejected";
          throw new TextGenerationError(code, `OpenRouter respondeu HTTP ${response.status}`);
        }
        let payload: unknown;
        try {
          payload = await response.json();
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            throw new TextGenerationError("provider_timeout", `OpenRouter timed out after ${timeoutMs}ms`);
          }
          throw new TextGenerationError("malformed_provider_response", "OpenRouter returned non-JSON output");
        }
        return parseCompletion(payload);
      } finally {
        clearTimer();
      }
    },
  });
}

const EMBEDDINGS_ENDPOINT = "https://openrouter.ai/api/v1/embeddings";
const MAX_EMBEDDING_INPUTS = 64;
const MAX_EMBEDDING_INPUT_CHARS = 8000;

export interface EmbeddingRequest {
  readonly model: string;
  readonly inputs: readonly string[];
}

export interface EmbeddingResult {
  readonly embeddings: readonly (readonly number[])[];
  readonly model: string;
  readonly usage: TextGenerationUsage;
}

/**
 * Port de embeddings do control-plane (conhecimento real / RAG).
 * Mesma chave e mesmo egress fixo do port de geração: o OpenRouter expõe
 * `/api/v1/embeddings` compatível com OpenAI, então nenhuma credencial nova
 * entra no sistema.
 */
export interface EmbeddingPort {
  readonly providerId: string;
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
}

export function createOpenRouterEmbeddingPort(options: OpenRouterAdapterOptions): EmbeddingPort {
  const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  if (apiKey.length < 8) {
    throw new TextGenerationError("missing_api_key", "OpenRouter API key is not configured");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImplementation = options.fetchImplementation ?? fetch;

  return Object.freeze({
    providerId: "openrouter",
    async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
      validateEmbeddingRequest(request);

      const { response, clearTimer } = await fetchWithRateLimitRetry(
        fetchImplementation,
        EMBEDDINGS_ENDPOINT,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            ...(options.appUrl ? { "HTTP-Referer": options.appUrl } : {}),
            ...(options.appTitle ? { "X-Title": options.appTitle } : {}),
          },
          body: JSON.stringify({ model: request.model, input: request.inputs }),
        },
        timeoutMs,
        "OpenRouter",
      );

      try {
        if (!response.ok) {
          // Corpo de erro nunca é repassado cru: pode ecoar headers/entrada.
          const code: TextGenerationErrorCode = response.status >= 500 ? "provider_unavailable" : "provider_rejected";
          throw new TextGenerationError(code, `OpenRouter respondeu HTTP ${response.status}`);
        }
        let payload: unknown;
        try {
          payload = await response.json();
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            throw new TextGenerationError("provider_timeout", `OpenRouter timed out after ${timeoutMs}ms`);
          }
          throw new TextGenerationError("malformed_provider_response", "OpenRouter returned non-JSON output");
        }
        return parseEmbeddings(payload, request.inputs.length);
      } finally {
        clearTimer();
      }
    },
  });
}

function validateEmbeddingRequest(request: EmbeddingRequest): void {
  if (typeof request.model !== "string" || !MODEL_PATTERN.test(request.model)) {
    throw new TextGenerationError("invalid_request", "model must be a plain OpenRouter model id");
  }
  if (!Array.isArray(request.inputs) || request.inputs.length === 0 || request.inputs.length > MAX_EMBEDDING_INPUTS) {
    throw new TextGenerationError("invalid_request", `inputs must contain 1..${MAX_EMBEDDING_INPUTS} entries`);
  }
  for (const input of request.inputs) {
    if (typeof input !== "string" || input.trim().length === 0 || input.length > MAX_EMBEDDING_INPUT_CHARS) {
      throw new TextGenerationError("invalid_request", `each input must be 1..${MAX_EMBEDDING_INPUT_CHARS} chars`);
    }
  }
}

function parseEmbeddings(payload: unknown, expectedCount: number): EmbeddingResult {
  if (payload === null || typeof payload !== "object") {
    throw new TextGenerationError("malformed_provider_response", "embeddings payload is not an object");
  }
  const record = payload as Record<string, unknown>;
  const data = record.data;
  if (!Array.isArray(data) || data.length !== expectedCount) {
    throw new TextGenerationError("malformed_provider_response", "embeddings payload count does not match inputs");
  }
  const ordered: (readonly number[])[] = new Array(expectedCount);
  for (const [position, entry] of data.entries()) {
    const item = (entry ?? null) as Record<string, unknown> | null;
    const vector = item?.embedding;
    if (!Array.isArray(vector) || vector.length === 0 || !vector.every((v) => typeof v === "number" && Number.isFinite(v))) {
      throw new TextGenerationError("malformed_provider_response", "embeddings payload has an invalid vector");
    }
    // OpenAI-compat: `index` referencia a posição do input; sem ele, usa a ordem do array.
    const index = typeof item?.index === "number" && Number.isInteger(item.index) ? item.index : position;
    if (index < 0 || index >= expectedCount || ordered[index] !== undefined) {
      throw new TextGenerationError("malformed_provider_response", "embeddings payload has inconsistent indexes");
    }
    ordered[index] = Object.freeze(vector.slice());
  }
  const usageRecord = (record.usage ?? {}) as Record<string, unknown>;
  const model = typeof record.model === "string" && record.model.length > 0 ? record.model : "openrouter/unknown";

  return Object.freeze({
    embeddings: Object.freeze(ordered),
    model,
    usage: Object.freeze({
      inputTokens: normalizeTokenCount(usageRecord.prompt_tokens ?? usageRecord.total_tokens),
      outputTokens: 0,
    }),
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
  const reportedCostUsd = normalizeReportedCost(usageRecord.cost);
  const model = typeof record.model === "string" && record.model.length > 0 ? record.model : "openrouter/unknown";

  return Object.freeze({
    text,
    model,
    usage: Object.freeze({
      inputTokens,
      outputTokens,
      ...(reportedCostUsd !== undefined ? { reportedCostUsd } : {}),
    }),
  });
}

/** usage.cost do OpenRouter: só aceita número finito não-negativo e plausível pra UMA chamada. */
function normalizeReportedCost(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10) return undefined;
  return value;
}

function normalizeTokenCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}
