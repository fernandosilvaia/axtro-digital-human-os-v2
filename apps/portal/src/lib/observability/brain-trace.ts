/**
 * Observabilidade de cada turno do cérebro no Langfuse, via OTLP/HTTP em JSON
 * (`/api/public/otel/v1/traces`), sem SDK e sem dependência nova. A rota da
 * ingestão antiga (`/api/public/ingestion`) sai do ar no Langfuse Cloud em
 * 2026-11-16, por isso o OTLP.
 *
 * Só metadado, nunca conteúdo: o que a pessoa disse, o que a persona
 * respondeu, argumentos e resultados de tool ficam fora do trace. Uma chamada
 * de vídeo carrega nome, contato e às vezes saúde e finanças, com
 * consentimento dado para conduzir a demonstração, não para mandar a fala a
 * um terceiro de observabilidade. O que vai: tempos, modelo, tokens (inclusive
 * os servidos do cache), custo, nomes de tool, códigos da sentinela e motivo
 * de degradação. Avaliação de conteúdo roda offline, nos cenários sintéticos
 * de `experiments/`.
 *
 * Nunca bloqueia nem derruba a fala: a rota agenda o envio com `after()`,
 * depois da resposta, e qualquer falha aqui vira um evento de telemetria.
 */

export interface LangfuseConfig {
  readonly endpoint: string;
  readonly authorization: string;
  readonly environment: string;
}

type Env = Readonly<Record<string, string | undefined>>;

const ENVIRONMENT_PATTERN = /^(?!langfuse)[a-z0-9_-]{1,40}$/;
const PUBLIC_KEY_PATTERN = /^pk-lf-[A-Za-z0-9-]{8,128}$/;
const SECRET_KEY_PATTERN = /^sk-lf-[A-Za-z0-9-]{8,128}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MAX_ATTRIBUTE_CHARS = 200;
const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * Sem as três variáveis (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`,
 * `LANGFUSE_BASE_URL`), o trace fica desligado. Não há URL padrão de
 * propósito: escolher entre Cloud EU, Cloud US ou instância própria é decisão
 * de residência de dado, não do código. HTTP só para o laboratório local.
 */
export function langfuseConfigFromEnv(env: Env): LangfuseConfig | null {
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim() ?? "";
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim() ?? "";
  const rawBaseUrl = (env.LANGFUSE_BASE_URL ?? env.LANGFUSE_HOST ?? "").trim();
  if (!PUBLIC_KEY_PATTERN.test(publicKey) || !SECRET_KEY_PATTERN.test(secretKey) || rawBaseUrl.length === 0) return null;
  let base: URL;
  try {
    base = new URL(rawBaseUrl);
  } catch {
    return null;
  }
  const secure = base.protocol === "https:" || (base.protocol === "http:" && LOCAL_HOSTS.has(base.hostname));
  if (!secure || base.username !== "" || base.password !== "" || base.search !== "" || base.hash !== "") return null;
  const configuredEnvironment = env.LANGFUSE_TRACING_ENVIRONMENT?.trim() ?? "";
  return Object.freeze({
    endpoint: `${base.origin}${base.pathname.replace(/\/+$/, "")}/api/public/otel/v1/traces`,
    authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`,
    environment: ENVIRONMENT_PATTERN.test(configuredEnvironment)
      ? configuredEnvironment
      : env.NODE_ENV === "production" ? "production" : "development",
  });
}

export interface TimedStep {
  readonly startedAtMs: number;
  readonly endedAtMs: number;
}

export interface BrainTurnTrace extends TimedStep {
  readonly tenantId: string;
  readonly agentId: string;
  readonly vertical: string;
  readonly language: string;
  readonly degradedReason?: string;
  /** Códigos da sentinela e do detector de risco, nunca a frase. */
  readonly guardrailFlags: readonly string[];
  readonly toolCallNames: readonly string[];
  /** Resumo do que coube no teto de entrada, só contagens (ex.: "knowledge 1/4, perception trimmed, history 6/12"). */
  readonly contextFit?: string;
  readonly contextTrimmed?: boolean;
  readonly retrieval?: TimedStep & { readonly matches: number; readonly failed: boolean };
  readonly generation?: TimedStep & {
    readonly model: string;
    readonly failed: boolean;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly cachedInputTokens?: number;
    readonly costUsd?: number;
  };
}

export interface TraceIds {
  readonly traceId: string;
  readonly rootSpanId: string;
  readonly retrievalSpanId: string;
  readonly generationSpanId: string;
}

type AttributeValue = { stringValue: string } | { arrayValue: { values: { stringValue: string }[] } };
interface Attribute { key: string; value: AttributeValue }

function bounded(value: string): string {
  return value.length <= MAX_ATTRIBUTE_CHARS ? value : value.slice(0, MAX_ATTRIBUTE_CHARS);
}

function text(key: string, value: string): Attribute {
  return { key, value: { stringValue: bounded(value) } };
}

function list(key: string, values: readonly string[]): Attribute {
  return { key, value: { arrayValue: { values: values.slice(0, 20).map((value) => ({ stringValue: bounded(value) })) } } };
}

/** OTLP/JSON: tempo em nanossegundos como string decimal (fixed64). */
function nanos(ms: number): string {
  return `${Math.max(0, Math.trunc(ms))}000000`;
}

function nonNegativeInteger(value: number | undefined): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Monta o corpo OTLP do turno. Puro: ids e relógio vêm de fora. */
export function brainTurnToOtlp(turn: BrainTurnTrace, config: Pick<LangfuseConfig, "environment">, ids: TraceIds): unknown {
  const degraded = turn.degradedReason !== undefined;
  const tags = [`vertical:${turn.vertical}`, `language:${turn.language}`];
  if (degraded) tags.push("degraded");
  if (turn.toolCallNames.length > 0) tags.push("tool_call");
  if (turn.guardrailFlags.length > 0) tags.push("guardrail");
  if (turn.contextTrimmed === true) tags.push("context_trimmed");

  const root = {
    traceId: ids.traceId,
    spanId: ids.rootSpanId,
    name: "brain_turn",
    kind: 2,
    startTimeUnixNano: nanos(turn.startedAtMs),
    endTimeUnixNano: nanos(turn.endedAtMs),
    attributes: [
      text("langfuse.trace.name", "brain_turn"),
      list("langfuse.trace.tags", tags),
      text("langfuse.environment", config.environment),
      text("langfuse.trace.metadata.tenant_id", turn.tenantId),
      text("langfuse.trace.metadata.agent_id", turn.agentId),
      text("langfuse.trace.metadata.vertical", turn.vertical),
      text("langfuse.trace.metadata.language", turn.language),
      text("langfuse.trace.metadata.degraded_reason", turn.degradedReason ?? "none"),
      text("langfuse.trace.metadata.guardrail_flags", turn.guardrailFlags.join(",")),
      text("langfuse.trace.metadata.tool_calls", turn.toolCallNames.join(",")),
      ...(turn.contextFit === undefined ? [] : [text("langfuse.trace.metadata.context_fit", turn.contextFit)]),
      ...(degraded ? [text("langfuse.observation.level", "WARNING"), text("langfuse.observation.status_message", turn.degradedReason ?? "")] : []),
    ],
    status: { code: degraded ? 2 : 1 },
  };

  const spans: unknown[] = [root];
  if (turn.retrieval !== undefined) {
    spans.push({
      traceId: ids.traceId,
      spanId: ids.retrievalSpanId,
      parentSpanId: ids.rootSpanId,
      name: "knowledge_retrieval",
      kind: 1,
      startTimeUnixNano: nanos(turn.retrieval.startedAtMs),
      endTimeUnixNano: nanos(turn.retrieval.endedAtMs),
      attributes: [
        text("langfuse.observation.type", "retriever"),
        text("langfuse.observation.metadata.matches", String(turn.retrieval.matches)),
        ...(turn.retrieval.failed ? [text("langfuse.observation.level", "WARNING")] : []),
      ],
      status: { code: turn.retrieval.failed ? 2 : 1 },
    });
  }
  if (turn.generation !== undefined) {
    const generation = turn.generation;
    const usage: Record<string, number> = {};
    const input = nonNegativeInteger(generation.inputTokens);
    const output = nonNegativeInteger(generation.outputTokens);
    const cached = nonNegativeInteger(generation.cachedInputTokens);
    if (input !== undefined) usage.input = input;
    if (output !== undefined) usage.output = output;
    if (cached !== undefined) usage.cache_read_input_tokens = cached;
    const cost = generation.costUsd !== undefined && Number.isFinite(generation.costUsd) && generation.costUsd >= 0
      ? generation.costUsd
      : undefined;
    spans.push({
      traceId: ids.traceId,
      spanId: ids.generationSpanId,
      parentSpanId: ids.rootSpanId,
      name: "generation",
      kind: 3,
      startTimeUnixNano: nanos(generation.startedAtMs),
      endTimeUnixNano: nanos(generation.endedAtMs),
      attributes: [
        text("langfuse.observation.type", "generation"),
        text("langfuse.observation.model.name", generation.model),
        ...(Object.keys(usage).length > 0 ? [text("langfuse.observation.usage_details", JSON.stringify(usage))] : []),
        ...(cost === undefined ? [] : [text("langfuse.observation.cost_details", JSON.stringify({ total: cost }))]),
        ...(generation.failed ? [text("langfuse.observation.level", "ERROR")] : []),
      ],
      status: { code: generation.failed ? 2 : 1 },
    });
  }

  return {
    resourceSpans: [{
      resource: { attributes: [text("service.name", "axtro-portal-brain")] },
      scopeSpans: [{ scope: { name: "axtro.brain", version: "1" }, spans }],
    }],
  };
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newTraceIds(hex: (bytes: number) => string = randomHex): TraceIds {
  return { traceId: hex(16), rootSpanId: hex(8), retrievalSpanId: hex(8), generationSpanId: hex(8) };
}

export interface ExportDeps {
  readonly config: LangfuseConfig | null;
  readonly fetchImplementation?: typeof fetch;
  readonly timeoutMs?: number;
  readonly ids?: TraceIds;
  /** Telemetria da própria falha de exportação; recebe só status ou nome do erro. */
  readonly onFailure?: (context: Readonly<Record<string, string | number>>) => void;
}

/** Envia o turno. Nunca lança: observabilidade não pode virar motivo de erro. */
export async function exportBrainTurn(turn: BrainTurnTrace, deps: ExportDeps): Promise<boolean> {
  const config = deps.config;
  if (config === null) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await (deps.fetchImplementation ?? fetch)(config.endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: config.authorization,
        "Content-Type": "application/json",
        "x-langfuse-ingestion-version": "4",
      },
      body: JSON.stringify(brainTurnToOtlp(turn, config, deps.ids ?? newTraceIds())),
    });
    // O corpo da resposta não é lido nem logado: pode ecoar o payload.
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) {
      deps.onFailure?.({ status: response.status });
      return false;
    }
    return true;
  } catch (error) {
    deps.onFailure?.({ reason: error instanceof Error ? error.name : "unknown" });
    return false;
  } finally {
    clearTimeout(timer);
  }
}
