import { after, NextRequest, NextResponse } from "next/server";

import { createOpenRouterTextGenerationPort, TextGenerationError } from "@axtro/provider-openrouter";

import { applyVerticalOverride } from "@/lib/brain/vertical-override";
import { contextWasTrimmed, parseCloserVertical, type BrainKnowledgeMatch, type ContextFitReport } from "@/lib/brain/chat-completion-core";
import { buildCompletionStream } from "@/lib/brain/completion-stream";
import { authenticateBrainRequest, brainLanguagesFromVideoConfig, BrainHttpError, handleBrainChatRequest, type BudgetVerdict, type ResolvedBrainAgent } from "@/lib/brain/handle-chat-request";
import {
  AI_USAGE_LIMITS,
  aiProviderRequestScope,
  beginAiUsage,
  commitAiUsage,
  configuredOpenRouterGenerationModel,
  markAiUsageInFlight,
  markAiUsageUnknown,
  recordAiUsageProviderFailure,
  releaseAiUsageNotDispatched,
  stableAiUsageIdempotencyKey,
  type AiUsageReservation,
} from "@/lib/ai-budget/reservations";
import { readBoundedTextBody } from "@/lib/http/read-bounded-body";
import { retrieveBrainKnowledge } from "@/lib/brain/knowledge-retrieval";
import { embedQuery, prepareEmbeddingQueryForReservedUsage } from "@/lib/knowledge";
import { createServiceRoleClient, ServiceRoleUnavailableError } from "@/lib/supabase/service";
import { exportBrainTurn, langfuseConfigFromEnv, type BrainTurnTrace } from "@/lib/observability/brain-trace";
import { logError as trackError, logEvent } from "@/lib/telemetry";

/**
 * Endpoint OpenAI-compatible que o Tavus chama como LLM da persona de vídeo
 * (`layers.llm.base_url`, M4-04). Wiring fino sobre `handleBrainChatRequest`
 * (puro e testado): resolve o segredo via service role (sem sessão de
 * usuário, chamada servidor-a-servidor), reserva atomicamente o pior caso
 * de custo antes de cada provider, aplica rate limit e formata a resposta em
 * SSE `chat.completion.chunk`.
 */
export const dynamic = "force-dynamic";

/**
 * Rate limit em memória por agente: uma call de vídeo real gera no máximo
 * um turno a cada poucos segundos: 40/min é folga generosa e ainda corta
 * um loop de script. Processo único no Railway; se um dia houver réplicas,
 * isto vira melhor-esforço por instância (a reserva transacional no banco
 * continua sendo a proteção dura de gasto).
 */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 40;
const RATE_LIMIT_MAX_AGENTS = 5_000;
const MAX_BRAIN_REQUEST_BYTES = 256 * 1_024;
const requestTimestampsByAgent = new Map<string, number[]>();

function isRateLimited(agentId: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (requestTimestampsByAgent.get(agentId) ?? []).filter((t) => t > cutoff);
  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    requestTimestampsByAgent.set(agentId, timestamps);
    return true;
  }
  timestamps.push(now);
  requestTimestampsByAgent.delete(agentId);
  requestTimestampsByAgent.set(agentId, timestamps);
  if (requestTimestampsByAgent.size > RATE_LIMIT_MAX_AGENTS) {
    const oldest = requestTimestampsByAgent.keys().next().value;
    if (oldest !== undefined && oldest !== agentId) requestTimestampsByAgent.delete(oldest);
  }
  return false;
}

function describeContextFit(fit: ContextFitReport): string {
  return `knowledge ${fit.knowledge.used}/${fit.knowledge.offered}, perception ${fit.perception}, provider ${fit.providerContext}, history ${fit.history.kept}/${fit.history.offered}`;
}

async function resolveConfig(secretHash: string): Promise<ResolvedBrainAgent | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("portal_resolve_agent_brain_config_service", {
    p_secret_hash: secretHash,
  });
  if (error) {
    trackError("brain_resolve_config_failed", error, {});
    return null;
  }
  const record = data as { found: boolean; tenant_id?: string; agent_id?: string; agent_name?: string; tenant_name?: string } | null;
  if (record === null || record.found !== true) return null;
  if (
    typeof record.tenant_id !== "string"
    || typeof record.agent_id !== "string"
    || typeof record.agent_name !== "string"
    || typeof record.tenant_name !== "string"
  ) {
    return null;
  }

  // Idioma da persona (agent_video_config.language): sem ele o cérebro
  // sempre falava pt-BR mesmo em persona EN (achado da auditoria 2026-08-02).
  // Espanhol usa as instruções em inglês e fala espanhol (D-V2-197).
  const { data: videoConfig } = await supabase
    .from("agent_video_config")
    .select("language, closer_vertical")
    .eq("tenant_id", record.tenant_id)
    .eq("agent_id", record.agent_id)
    .maybeSingle();
  const languages = brainLanguagesFromVideoConfig(videoConfig?.language);

  // Vertical de doutrina (0063). Valor ausente ou desconhecido cai em
  // `metodo_silva` dentro de parseCloserVertical: se a coluna ainda nao
  // existir neste banco o select inteiro falha, videoConfig vem undefined e a
  // call degrada para a doutrina generica em vez de cair.
  // BRAIN_VERTICAL_OVERRIDES liga a vertical `billion_leads_sales` por agente sem migration;
  // só sobe `metodo_silva` (ver vertical-override.ts).
  const closerVertical = applyVerticalOverride(parseCloserVertical(videoConfig?.closer_vertical), record.agent_id, process.env.BRAIN_VERTICAL_OVERRIDES);

  return {
    tenantId: record.tenant_id,
    agentId: record.agent_id,
    agentName: record.agent_name,
    tenantName: record.tenant_name,
    enabled: true,
    ...languages,
    closerVertical,
  };
}

/** Hybrid knowledge is untrusted data, bounded and scoped to the resolved tenant. */
async function retrieveKnowledge(
  tenantId: string, agentId: string, queryText: string, idempotencyMaterial: string,
): Promise<readonly BrainKnowledgeMatch[]> {
  return retrieveBrainKnowledge({ tenantId, agentId, queryText, idempotencyMaterial }, {
    client: createServiceRoleClient(), apiKey: process.env.OPENROUTER_API_KEY ?? "",
    prepare: prepareEmbeddingQueryForReservedUsage, embed: embedQuery,
    recordEvent: (code) => logEvent(code, { tenant_id: tenantId, agent_id: agentId }),
  });
}


export async function POST(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  const { agentId } = await context.params;
  const turnStartedAtMs = Date.now();
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  if (apiKey.trim().length === 0) {
    return NextResponse.json({ error: "language_provider_not_configured" }, { status: 503 });
  }

  let authenticatedConfig: ResolvedBrainAgent;
  try {
    authenticatedConfig = await authenticateBrainRequest(
      { authorizationHeader: request.headers.get("authorization"), agentIdFromPath: agentId },
      resolveConfig,
    );
  } catch (error) {
    if (error instanceof BrainHttpError) return NextResponse.json({ error: "unauthorized" }, { status: error.status });
    if (error instanceof ServiceRoleUnavailableError) return NextResponse.json({ error: "brain_not_configured" }, { status: 503 });
    throw error;
  }
  if (isRateLimited(authenticatedConfig.agentId)) {
    logEvent("brain_rate_limited", { agent_id: authenticatedConfig.agentId });
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let providerModel: string;
  try {
    providerModel = configuredOpenRouterGenerationModel(process.env);
  } catch (error) {
    trackError("brain_ai_rate_card_configuration_invalid", error, { agent_id: authenticatedConfig.agentId });
    return NextResponse.json({ error: "language_provider_not_configured" }, { status: 503 });
  }

  // Somente depois do bearer ser validado confiamos numa identidade enviada
  // pelo provider. Sem header estavel usamos um request-scope novo, evitando
  // que duas conversas com mensagens identicas reciclem o mesmo commit.
  const providerRequestScope = aiProviderRequestScope(
    request.headers.get("idempotency-key") ?? request.headers.get("x-request-id"),
  );

  // Autentica e limita ANTES de ler/deserializar corpo controlado pelo
  // chamador. Isso evita que um segredo ausente/inválido compre CPU e memória
  // proporcional ao payload no endpoint server-to-server.
  const boundedBody = await readBoundedTextBody(request, MAX_BRAIN_REQUEST_BYTES);
  if (!boundedBody.ok) {
    return boundedBody.reason === "too_large"
      ? NextResponse.json({ error: "payload_too_large" }, { status: 413 })
      : NextResponse.json({ error: "invalid_request_body" }, { status: 400 });
  }
  let body: unknown;
  try {
    body = JSON.parse(boundedBody.text);
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }
  const rawMessages = (body as { messages?: unknown } | null)?.messages;
  const rawTools = (body as { tools?: unknown } | null)?.tools;
  const canonicalMessages = Array.isArray(rawMessages)
    ? rawMessages.map((message) => {
      if (message === null || typeof message !== "object") return message;
      const record = message as Record<string, unknown>;
      return { role: record.role, content: record.content };
    })
    : rawMessages;
  const model = typeof (body as { model?: unknown } | null)?.model === "string"
    ? (body as { model: string }).model
    : "axtro-digital-human-os-brain";

  const port = createOpenRouterTextGenerationPort({
    apiKey,
    appUrl: "https://portal-production-b43e.up.railway.app",
    appTitle: "Axtro Digital Human OS Brain",
  });
  const reservationMaterial = `${authenticatedConfig.tenantId}:${agentId}:${providerRequestScope}:${JSON.stringify(canonicalMessages)}`;
  const serviceClient = createServiceRoleClient();
  let generationReservation: AiUsageReservation | null = null;
  let generationDispatched = false;
  let generationTerminalRecorded = false;
  let generationReportedCostUsd: number | undefined;
  // Só metadado do turno, para o Langfuse (brain-trace.ts): nunca fala, nunca argumento de tool.
  let retrievalStep: BrainTurnTrace["retrieval"];
  let generationStep: BrainTurnTrace["generation"];
  // Fecha a reserva com o que o provedor cobrou. Usado no caminho normal e
  // quando a resposta paga veio sem nada aproveitável mas com usage informado.
  const commitGenerationUsage = async (inputTokens: number, outputTokens: number, reportedCostUsd: number | undefined): Promise<void> => {
    if (generationReservation === null) throw new Error("AI usage reservation missing at commit");
    const committed = await commitAiUsage(serviceClient, generationReservation, {
      inputTokens,
      outputTokens,
      ...(reportedCostUsd === undefined ? {} : { reportedCostUsd }),
    });
    generationTerminalRecorded = true;
    if (!committed) {
      await markAiUsageUnknown(serviceClient, generationReservation, "usage_commit_failed");
      trackError("brain_ai_usage_commit_failed", new Error("generation reservation did not commit"), {
        tenant_id: authenticatedConfig.tenantId,
        agent_id: authenticatedConfig.agentId,
        reservation_id: generationReservation.id,
        operation: "brain_generation",
      });
      throw new Error("AI usage commit failed after provider success");
    }
  };
  const scheduleTurnTrace = (outcome: { degradedReason?: string; guardrailFlags?: readonly string[]; toolCallNames?: readonly string[]; contextFit?: ContextFitReport }) => {
    const config = langfuseConfigFromEnv(process.env);
    if (config === null) return;
    const turn: BrainTurnTrace = {
      tenantId: authenticatedConfig.tenantId,
      agentId: authenticatedConfig.agentId,
      vertical: authenticatedConfig.closerVertical ?? "metodo_silva",
      language: authenticatedConfig.spokenLanguage ?? authenticatedConfig.language ?? "default",
      startedAtMs: turnStartedAtMs,
      endedAtMs: Date.now(),
      guardrailFlags: outcome.guardrailFlags ?? [],
      toolCallNames: outcome.toolCallNames ?? [],
      ...(outcome.contextFit === undefined ? {} : {
        contextFit: describeContextFit(outcome.contextFit),
        contextTrimmed: contextWasTrimmed(outcome.contextFit),
      }),
      ...(outcome.degradedReason === undefined ? {} : { degradedReason: outcome.degradedReason }),
      ...(retrievalStep === undefined ? {} : { retrieval: retrievalStep }),
      ...(generationStep === undefined ? {} : { generation: generationStep }),
    };
    after(() => exportBrainTurn(turn, {
      config,
      onFailure: (failure) => logEvent("brain_trace_export_failed", { agent_id: authenticatedConfig.agentId, ...failure }),
    }));
  };

  try {
    const result = await handleBrainChatRequest(
      {
        authorizationHeader: request.headers.get("authorization"),
        agentIdFromPath: agentId,
        rawMessages,
        rawTools,
      },
      {
        resolveConfig: async () => authenticatedConfig,
        checkBudget: async (tenantId): Promise<BudgetVerdict> => {
          const begin = await beginAiUsage({
            client: serviceClient,
            operation: "brain_generation",
            idempotencyKey: stableAiUsageIdempotencyKey("brain_generation", reservationMaterial),
            tenantId,
            agentId,
          });
          if (!begin.allowed) return begin.reason === "capped" ? "exhausted" : "unavailable";
          if (begin.reservation.state !== "reserved") return "unavailable";
          generationReservation = begin.reservation;
          return "allowed";
        },
        retrieveKnowledge: async (tenantId, queryText) => {
          const startedAtMs = Date.now();
          try {
            const matches = await retrieveKnowledge(tenantId, agentId, queryText, reservationMaterial);
            retrievalStep = { startedAtMs, endedAtMs: Date.now(), matches: matches.length, failed: false };
            return matches;
          } catch (error) {
            retrievalStep = { startedAtMs, endedAtMs: Date.now(), matches: 0, failed: true };
            throw error;
          }
        },
        generate: async (messages, maxOutputTokens, options) => {
          if (generationReservation === null) throw new Error("AI usage reservation missing");
          generationDispatched = await markAiUsageInFlight(serviceClient, generationReservation);
          if (!generationDispatched) throw new Error("AI usage reservation is not executable");
          const startedAtMs = Date.now();
          let generated: Awaited<ReturnType<typeof port.generate>>;
          try {
            generated = await port.generate({
              model: providerModel,
              messages,
              maxOutputTokens,
              ...(options?.tools === undefined ? {} : { tools: options.tools }),
              ...(options?.cacheSystemPrompt === true ? { cacheSystemPrompt: true } : {}),
            });
          } catch (error) {
            generationStep = { startedAtMs, endedAtMs: Date.now(), model: providerModel, failed: true };
            // Resposta paga e sem nada aproveitável (ex.: tool call truncada),
            // mas com usage informado: o custo é conhecido, então a reserva
            // fecha com ele. Antes virava "desconhecido" e travava a IA do
            // tenant até uma reconciliação manual.
            if (error instanceof TextGenerationError && error.billedUsage !== undefined && !generationTerminalRecorded) {
              await commitGenerationUsage(error.billedUsage.inputTokens, error.billedUsage.outputTokens, error.billedUsage.reportedCostUsd);
            }
            throw error;
          }
          if (generated.droppedToolCalls !== undefined) {
            logEvent("brain_tool_calls_dropped", { agent_id: authenticatedConfig.agentId, count: generated.droppedToolCalls });
          }
          generationReportedCostUsd = generated.usage.reportedCostUsd;
          generationStep = {
            startedAtMs,
            endedAtMs: Date.now(),
            model: generated.model,
            failed: false,
            inputTokens: generated.usage.inputTokens,
            outputTokens: generated.usage.outputTokens,
            ...(generated.usage.cachedInputTokens === undefined ? {} : { cachedInputTokens: generated.usage.cachedInputTokens }),
            ...(generated.usage.reportedCostUsd === undefined ? {} : { costUsd: generated.usage.reportedCostUsd }),
          };
          return generated;
        },
        logGenerationUsage: async (_tenantId, _agentId, inputTokens, outputTokens) => {
          await commitGenerationUsage(inputTokens, outputTokens, generationReportedCostUsd);
        },
      },
    );
    if (generationReservation !== null && result.degraded) {
      if (generationDispatched && !generationTerminalRecorded && result.degradedReason === "generation_failed") {
        await recordAiUsageProviderFailure(serviceClient, generationReservation, result.cause);
        generationTerminalRecorded = true;
      } else if (!generationDispatched) {
        await releaseAiUsageNotDispatched(serviceClient, generationReservation);
      }
    }
    if (result.degraded) {
      // Degradação NUNCA pode parecer saúde na operação (Art. 16): era um
      // catch vazio; agora todo fallback vira telemetria com o motivo real.
      if (result.degradedReason === "generation_failed" || result.degradedReason === "malformed_request") {
        trackError(`brain_degraded_${result.degradedReason}`, result.cause ?? new Error(result.degradedReason), { agent_id: agentId });
      } else {
        logEvent(`brain_degraded_${result.degradedReason ?? "unknown"}`, { agent_id: agentId });
      }
    }
    if (result.guardrailFlags.length > 0) {
      // Detecção não-bloqueante (achado P1, auditoria 2026-08-12): os
      // guardrails anti-promessa só existem como texto de prompt, sem
      // checagem de código: isto não impede a fala, só dá visibilidade
      // real de quando o padrão de risco aparece na resposta gerada.
      // Nunca loga o conteúdo da fala em si (redação de PII/conversa).
      logEvent("brain_guardrail_risk_detected", { agent_id: agentId, flags: result.guardrailFlags.join(",") });
    }
    if (result.contextFit !== undefined && contextWasTrimmed(result.contextFit)) {
      // O encaixe no teto cortou contexto: degradação nunca pode parecer saúde
      // (Art. 16). Só contagens e estados, nunca o conteúdo cortado.
      logEvent("brain_context_trimmed", {
        agent_id: agentId,
        knowledge_used: result.contextFit.knowledge.used,
        knowledge_offered: result.contextFit.knowledge.offered,
        perception: result.contextFit.perception,
        provider_context: result.contextFit.providerContext,
        history_kept: result.contextFit.history.kept,
        history_offered: result.contextFit.history.offered,
      });
    }
    if (result.toolCalls.length > 0) {
      // Só nomes: argumentos podem carregar contato do prospect.
      logEvent("brain_tool_calls", { agent_id: agentId, tools: result.toolCalls.map((call) => call.name).join(",") });
    }
    scheduleTurnTrace({
      ...(result.degradedReason === undefined ? {} : { degradedReason: result.degradedReason }),
      guardrailFlags: result.guardrailFlags,
      toolCallNames: result.toolCalls.map((call) => call.name),
      ...(result.contextFit === undefined ? {} : { contextFit: result.contextFit }),
    });
    return new Response(buildCompletionStream(result.reply, model, result.toolCalls), {
      status: 200,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  } catch (error) {
    if (error instanceof BrainHttpError) {
      // Falha de autenticação: rejeição dura, sem tocar dado de tenant, sem detalhe que ajude a adivinhar o segredo certo.
      return NextResponse.json({ error: "unauthorized" }, { status: error.status });
    }
    if (error instanceof ServiceRoleUnavailableError) {
      trackError("brain_service_role_unavailable", error, { agent_id: agentId });
      return NextResponse.json({ error: "brain_not_configured" }, { status: 503 });
    }
    trackError("brain_chat_completions_unexpected_error", error, { agent_id: agentId });
    scheduleTurnTrace({ degradedReason: "internal_error" });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
