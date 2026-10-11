/**
 * Primeiro adapter de provider REAL do projeto (ADR-033, D-V2-064).
 *
 * Escopo deliberadamente estreito: geração de texto request/response para o
 * chat de teste de agente do portal (control-plane). O pipeline realtime de
 * voz/avatar de M2 continua fake-first atrás dos contratos congelados de
 * `@axtro/provider-contracts` (`providerMode: "fake"`) até o bake-off
 * credenciado (D-V2-048). Este pacote não toca aqueles ports.
 *
 * Guardrails estruturais:
 * - egress fixo em https://openrouter.ai (o chamador não escolhe URL);
 * - a chave nunca aparece em erros, logs ou no objeto de resultado;
 * - limites fechados de mensagens, tamanho e max_tokens;
 * - timeout obrigatório com AbortController;
 * - fetch injetável: os testes cobrem o adapter sem rede.
 */

import {
  openRouterPrivacyRoutingConfigurationFingerprint,
  type OpenRouterPrivacyRoutingConfiguration,
} from "./processing-profile.js";

export * from "./processing-profile.js";

export interface TextGenerationMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

/** Função oferecida ao modelo (formato OpenAI de function calling). */
export interface TextGenerationTool {
  readonly name: string;
  readonly description: string;
  /** JSON Schema do objeto de argumentos. */
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** Chamada de função devolvida pelo modelo; `argumentsJson` é sempre um objeto JSON serializado. */
export interface TextGenerationToolCall {
  readonly id: string;
  readonly name: string;
  readonly argumentsJson: string;
}

export interface TextGenerationRequest {
  readonly model: string;
  readonly messages: readonly TextGenerationMessage[];
  readonly maxOutputTokens: number;
  /** Funções que o modelo pode chamar nesta geração. Ausente = só texto. */
  readonly tools?: readonly TextGenerationTool[];
  /**
   * Marca o prefixo estático (as mensagens system) para cache no provedor.
   * Só modelos Anthropic precisam de marcação explícita (cache_control); os
   * demais fazem cache automático e ignoram a marcação.
   */
  readonly cacheSystemPrompt?: boolean;
}

export interface TextGenerationUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /**
   * Custo faturado em USD reportado pelo próprio OpenRouter (usage.cost,
   * pedido via `usage: {include: true}` no request). Ausente quando o
   * provider não reporta. O caller decide se estima por tabela.
   */
  readonly reportedCostUsd?: number;
}

export interface TextGenerationResult {
  /** Pode ser vazio somente quando `toolCalls` vem preenchido. */
  readonly text: string;
  /** Presente só quando o modelo pediu ao menos uma função oferecida. */
  readonly toolCalls?: readonly TextGenerationToolCall[];
  readonly model: string;
  readonly usage: TextGenerationUsage;
  /** Opaque provider identity used only by durable completion/reconciliation. */
  readonly providerRequestId: string | null;
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
  /**
   * Opt-in fence for the Portal preview. Existing generation and embedding
   * callers remain unchanged until M6-06 authorizes their rollout.
   */
  readonly privacy?: Readonly<{
    readonly routingConfiguration: OpenRouterPrivacyRoutingConfiguration;
    readonly revalidateBeforeDispatch: () => void | Promise<void>;
  }>;
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MAX_MESSAGES = 24;
const MAX_TOOLS = 8;
const MAX_TOOL_DESCRIPTION_CHARS = 1024;
const MAX_TOOL_SCHEMA_CHARS = 8_000;
const MAX_TOOL_CALLS = 4;
const MAX_TOOL_ARGUMENT_CHARS = 4_000;
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const TOOL_CALL_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_MESSAGE_CHARS = 4000;
const MAX_OUTPUT_TOKENS_CAP = 1024;
const MODEL_PATTERN = /^[a-z0-9][a-z0-9._\/:-]{2,127}$/i;
const DEFAULT_TIMEOUT_MS = 30_000;
interface ProviderAttempt {
  readonly response: Response;
  readonly clearTimer: () => void;
}

/** One physical paid attempt per reservation; timeout covers the response body. */
async function fetchSingleAttempt(
  fetchImplementation: typeof fetch,
  url: string,
  init: { readonly method: string; readonly headers: Record<string, string>; readonly body: string },
  timeoutMs: number,
  providerLabel: string,
  revalidateBeforeDispatch?: () => void | Promise<void>,
): Promise<ProviderAttempt> {
  await revalidateBeforeDispatch?.();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImplementation(url, { ...init, signal: controller.signal });
    return { response, clearTimer: () => {
      clearTimeout(timer);
      controller.abort();
    } };
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof Error && error.name === "AbortError") {
      throw new TextGenerationError("provider_timeout", `${providerLabel} timed out after ${timeoutMs}ms`);
    }
    throw new TextGenerationError("provider_unavailable", `${providerLabel} request failed before a response`);
  }
}

export function createOpenRouterTextGenerationPort(options: OpenRouterAdapterOptions): TextGenerationPort {
  const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  if (apiKey.length < 8) {
    throw new TextGenerationError("missing_api_key", "OpenRouter API key is not configured");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const configuredPrivacy = options.privacy;
  let privacy: OpenRouterAdapterOptions["privacy"];
  if (configuredPrivacy !== undefined) {
    if (typeof configuredPrivacy.revalidateBeforeDispatch !== "function") {
      throw new TextGenerationError("invalid_request", "OpenRouter privacy revalidator is not configured");
    }
    try {
      openRouterPrivacyRoutingConfigurationFingerprint(configuredPrivacy.routingConfiguration);
    } catch {
      throw new TextGenerationError("invalid_request", "OpenRouter privacy routing is invalid");
    }
    privacy = Object.freeze({
      routingConfiguration: Object.freeze({
        provider: Object.freeze({
          data_collection: "deny",
          zdr: true,
          allow_fallbacks: false,
          require_parameters: true,
        }),
      }),
      revalidateBeforeDispatch: configuredPrivacy.revalidateBeforeDispatch,
    });
  }

  return Object.freeze({
    providerId: "openrouter",
    async generate(request: TextGenerationRequest): Promise<TextGenerationResult> {
      validateRequest(request);

      const { response, clearTimer } = await fetchSingleAttempt(
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
            messages: serializeMessages(request),
            max_tokens: request.maxOutputTokens,
            ...(request.tools !== undefined && request.tools.length > 0
              ? {
                tools: request.tools.map((tool) => ({
                  type: "function",
                  function: { name: tool.name, description: tool.description, parameters: tool.parameters },
                })),
                tool_choice: "auto",
              }
              : {}),
            ...(privacy === undefined ? {} : {
              provider: privacy.routingConfiguration.provider,
            }),
            // Pede o custo faturado real na resposta (usage.cost): evita
            // dupla manutenção de preço de tabela no SQL pro caminho de chat
            // e cobre qualquer OPENROUTER_MODEL configurado (0027).
            usage: { include: true },
          }),
        },
        timeoutMs,
        "OpenRouter",
        privacy?.revalidateBeforeDispatch,
      );

      // O timer segue vivo até o corpo ser consumido: headers rápidos com
      // body pendurado não escapam do timeout (auditoria 2026-08-02).
      try {
        if (!response.ok) {
          // Cancel unread bodies without awaiting hostile/pending cancellation; finally aborts this request.
          void response.body?.cancel().catch(() => {});
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
        const completion = parseCompletion(payload, new Set((request.tools ?? []).map((tool) => tool.name)));
        if (privacy !== undefined && completion.providerRequestId === null) {
          throw new TextGenerationError(
            "malformed_provider_response",
            "OpenRouter privacy-fenced response has no provider request identity",
          );
        }
        return completion;
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

      const { response, clearTimer } = await fetchSingleAttempt(
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
          body: JSON.stringify({
            model: request.model,
            input: request.inputs,
            // Pede o custo faturado real na resposta (usage.cost): sem isto
            // normalizeReportedCost sempre recebe undefined e todo commit de
            // ingestão cai no fallback max_cost_usd em vez do gasto real
            // (mesmo padrão do port de chat acima).
            usage: { include: true },
          }),
        },
        timeoutMs,
        "OpenRouter",
      );

      try {
        if (!response.ok) {
          // Cancel unread bodies without awaiting hostile/pending cancellation; finally aborts this request.
          void response.body?.cancel().catch(() => {});
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
  const reportedCostUsd = normalizeReportedCost(usageRecord.cost);

  return Object.freeze({
    embeddings: Object.freeze(ordered),
    model,
    usage: Object.freeze({
      inputTokens: normalizeTokenCount(usageRecord.prompt_tokens ?? usageRecord.total_tokens),
      outputTokens: 0,
      ...(reportedCostUsd === undefined ? {} : { reportedCostUsd }),
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
  if (request.tools !== undefined) validateTools(request.tools);
}

function validateTools(tools: readonly TextGenerationTool[]): void {
  if (!Array.isArray(tools) || tools.length > MAX_TOOLS) {
    throw new TextGenerationError("invalid_request", `tools must contain at most ${MAX_TOOLS} entries`);
  }
  const names = new Set<string>();
  for (const tool of tools) {
    if (typeof tool?.name !== "string" || !TOOL_NAME_PATTERN.test(tool.name) || names.has(tool.name)) {
      throw new TextGenerationError("invalid_request", "tool names must be unique snake_case identifiers");
    }
    names.add(tool.name);
    if (typeof tool.description !== "string" || tool.description.length === 0 || tool.description.length > MAX_TOOL_DESCRIPTION_CHARS) {
      throw new TextGenerationError("invalid_request", `tool description must be 1..${MAX_TOOL_DESCRIPTION_CHARS} chars`);
    }
    const schema = tool.parameters;
    if (schema === null || typeof schema !== "object" || Array.isArray(schema) || schema.type !== "object") {
      throw new TextGenerationError("invalid_request", "tool parameters must be a JSON Schema object");
    }
    if (JSON.stringify(schema).length > MAX_TOOL_SCHEMA_CHARS) {
      throw new TextGenerationError("invalid_request", `tool parameters must serialize to at most ${MAX_TOOL_SCHEMA_CHARS} chars`);
    }
  }
}

/**
 * Mensagens no formato do provedor. Com cache pedido num modelo Anthropic, a
 * ÚLTIMA mensagem system vira parte de conteúdo com cache_control: o provedor
 * guarda todo o prefixo até ali (ferramentas e prompt estático), que é igual em
 * todo turno da mesma persona.
 */
function serializeMessages(request: TextGenerationRequest): unknown[] {
  const cacheIndex = request.cacheSystemPrompt === true && request.model.toLowerCase().startsWith("anthropic/")
    ? request.messages.reduce((last, message, index) => (message.role === "system" ? index : last), -1)
    : -1;
  return request.messages.map((message, index) => (index === cacheIndex
    ? { role: message.role, content: [{ type: "text", text: message.content, cache_control: { type: "ephemeral" } }] }
    : { role: message.role, content: message.content }));
}

function parseToolCalls(value: unknown, offered: ReadonlySet<string>): TextGenerationToolCall[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_TOOL_CALLS) {
    throw new TextGenerationError("malformed_provider_response", "completion tool_calls is not a bounded array");
  }
  const calls: TextGenerationToolCall[] = [];
  for (const entry of value) {
    const record = (entry ?? null) as Record<string, unknown> | null;
    const fn = (record?.function ?? null) as Record<string, unknown> | null;
    const id = record?.id;
    const name = fn?.name;
    const rawArguments = fn?.arguments;
    if (typeof id !== "string" || !TOOL_CALL_ID_PATTERN.test(id) || typeof name !== "string" || !TOOL_NAME_PATTERN.test(name)) {
      throw new TextGenerationError("malformed_provider_response", "completion tool call has no valid id or name");
    }
    // Função que não foi oferecida é alucinação do modelo: nunca vira ação.
    if (!offered.has(name)) continue;
    const argumentsText = typeof rawArguments === "string" && rawArguments.trim().length > 0 ? rawArguments : "{}";
    if (argumentsText.length > MAX_TOOL_ARGUMENT_CHARS) {
      throw new TextGenerationError("malformed_provider_response", "completion tool call arguments are too large");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(argumentsText);
    } catch {
      throw new TextGenerationError("malformed_provider_response", "completion tool call arguments are not JSON");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TextGenerationError("malformed_provider_response", "completion tool call arguments must be a JSON object");
    }
    calls.push(Object.freeze({ id, name, argumentsJson: JSON.stringify(parsed) }));
  }
  return calls;
}

function parseCompletion(payload: unknown, offeredTools: ReadonlySet<string> = new Set()): TextGenerationResult {
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
  const toolCalls = parseToolCalls(message?.tool_calls, offeredTools);
  const rawText = message?.content;
  const text = typeof rawText === "string" ? rawText : "";
  if (text.length === 0 && toolCalls.length === 0) {
    throw new TextGenerationError("malformed_provider_response", "completion payload has no text content");
  }
  if (rawText !== undefined && rawText !== null && typeof rawText !== "string") {
    throw new TextGenerationError("malformed_provider_response", "completion text content must be a string");
  }
  const usageRecord = (record.usage ?? {}) as Record<string, unknown>;
  const inputTokens = normalizeTokenCount(usageRecord.prompt_tokens);
  const outputTokens = normalizeTokenCount(usageRecord.completion_tokens);
  const reportedCostUsd = normalizeReportedCost(usageRecord.cost);
  const model = typeof record.model === "string" && record.model.length > 0 ? record.model : "openrouter/unknown";
  const providerRequestId = typeof record.id === "string"
    && /^[!-~]{1,128}$/.test(record.id)
    ? record.id
    : null;

  return Object.freeze({
    text,
    ...(toolCalls.length > 0 ? { toolCalls: Object.freeze(toolCalls) } : {}),
    model,
    providerRequestId,
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
