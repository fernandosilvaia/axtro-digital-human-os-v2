import { NextRequest, NextResponse } from "next/server";

import { createUuidV7 } from "@axtro/domain";
import { createOpenRouterTextGenerationPort } from "@axtro/provider-openrouter";

import type { BrainKnowledgeMatch } from "@/lib/brain/chat-completion-core";
import type { BrainLanguage } from "@/lib/brain/metodo-silva";
import { authenticateBrainRequest, BrainHttpError, handleBrainChatRequest, type BudgetVerdict, type ResolvedBrainAgent } from "@/lib/brain/handle-chat-request";
import {
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
import { embedQuery } from "@/lib/knowledge";
import { createServiceRoleClient, ServiceRoleUnavailableError } from "@/lib/supabase/service";
import { logError as trackError, logEvent } from "@/lib/telemetry";

/**
 * Endpoint OpenAI-compatible que o Tavus chama como LLM da persona de vídeo
 * (`layers.llm.base_url`, M4-04). Wiring fino sobre `handleBrainChatRequest`
 * (puro e testado): resolve o segredo via service role (sem sessão de
 * usuário — chamada servidor-a-servidor), reserva atomicamente o pior caso
 * de custo antes de cada provider, aplica rate limit e formata a resposta em
 * SSE `chat.completion.chunk`.
 */
export const dynamic = "force-dynamic";

/**
 * Rate limit em memória por agente: uma call de vídeo real gera no máximo
 * um turno a cada poucos segundos — 40/min é folga generosa e ainda corta
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

  // Idioma da persona (agent_video_config.language) — sem ele o cérebro
  // sempre falava pt-BR mesmo em persona EN (achado da auditoria 2026-08-02).
  let language: BrainLanguage | undefined;
  const { data: videoConfig } = await supabase
    .from("agent_video_config")
    .select("language")
    .eq("tenant_id", record.tenant_id)
    .eq("agent_id", record.agent_id)
    .maybeSingle();
  if (videoConfig?.language === "english") language = "english";
  else if (videoConfig?.language === "portuguese") language = "portuguese";

  return {
    tenantId: record.tenant_id,
    agentId: record.agent_id,
    agentName: record.agent_name,
    tenantName: record.tenant_name,
    enabled: true,
    ...(language === undefined ? {} : { language }),
  };
}

/**
 * RAG pro caminho de vídeo (fecha o gap declarado desde D-V2-083/M4-04):
 * embeda a pergunta e busca via `portal_search_knowledge_service` (0032,
 * variante service-role de `portal_search_knowledge`, 0010 — mesmo corpo de
 * busca, só resolve o tenant por `p_tenant_id` explícito em vez de
 * `auth.uid()`, que não existe nesta chamada servidor-a-servidor). Mesmo
 * piso de similaridade do caminho de chat (agent-preview.ts, 0.25 em cosine
 * do text-embedding-3-small) — sem ele, ~1k tokens de chunks irrelevantes
 * entrariam como "mais relevantes" pra qualquer pergunta.
 *
 * Falha (embedding indisponível, RPC fora do ar) SEMPRE degrada pra `[]`,
 * nunca lança — RAG indisponível não pode derrubar a call de vídeo, e sem
 * fontes o agente não inventa (Art. 14).
 *
 * A chamada de embedding também usa reserva prévia, fence antes do envio e
 * commit com tokens/custo reportado. Falha ambígua fecha o tenant até a
 * reconciliação, mas o RAG ainda degrada para `[]` sem expor conversa no log.
 */
async function retrieveKnowledge(
  tenantId: string,
  agentId: string,
  queryText: string,
  idempotencyMaterial: string,
): Promise<readonly BrainKnowledgeMatch[]> {
  const trimmed = queryText.trim();
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  if (trimmed.length === 0 || apiKey.trim().length === 0) return [];

  const supabase = createServiceRoleClient();
  const begin = await beginAiUsage({
    client: supabase,
    tenantId,
    operation: "knowledge_query_embedding",
    idempotencyKey: stableAiUsageIdempotencyKey("knowledge_query_embedding", idempotencyMaterial),
    agentId,
  });
  if (!begin.allowed) return [];
  const reservation = begin.reservation;
  let providerDispatched = false;
  let terminalRecorded = false;
  try {
    providerDispatched = await markAiUsageInFlight(supabase, reservation);
    if (!providerDispatched) return [];
    const { embedding, inputTokens, reportedCostUsd } = await embedQuery(apiKey, trimmed);
    const committed = await commitAiUsage(supabase, reservation, {
      inputTokens,
      outputTokens: 0,
      ...(reportedCostUsd === undefined ? {} : { reportedCostUsd }),
    });
    if (!committed) {
      await markAiUsageUnknown(supabase, reservation, "usage_commit_failed");
      terminalRecorded = true;
      trackError("brain_ai_usage_commit_failed", new Error("knowledge query reservation did not commit"), { tenant_id: tenantId, agent_id: agentId });
      return [];
    }
    const { data, error } = await supabase.rpc("portal_search_knowledge_service", {
      p_tenant_id: tenantId,
      p_embedding: embedding,
      p_limit: 5,
    });
    if (error) {
      trackError("brain_knowledge_search_failed", error, { tenant_id: tenantId });
      return [];
    }
    if (!Array.isArray(data)) return [];
    return (data as (BrainKnowledgeMatch & { similarity?: number })[])
      .filter((match) => typeof match.similarity !== "number" || match.similarity >= 0.25)
      .map((match) => ({ source_name: match.source_name, chunk_text: match.chunk_text }));
  } catch (error) {
    if (providerDispatched && !terminalRecorded) {
      await recordAiUsageProviderFailure(supabase, reservation, error);
      terminalRecorded = true;
    } else if (!providerDispatched) {
      await releaseAiUsageNotDispatched(supabase, reservation);
    }
    trackError("brain_knowledge_retrieval_failed", error, { tenant_id: tenantId });
    return [];
  }
}

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function buildCompletionStream(reply: string, model: string): ReadableStream<Uint8Array> {
  const id = `brain-${createUuidV7()}`;
  const created = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseChunk({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: { role: "assistant", content: reply }, finish_reason: null }],
      })));
      controller.enqueue(encoder.encode(sseChunk({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      })));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  const { agentId } = await context.params;
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
    appTitle: "Axtro Digital Human OS — Brain",
  });
  const reservationMaterial = `${authenticatedConfig.tenantId}:${agentId}:${providerRequestScope}:${JSON.stringify(canonicalMessages)}`;
  const serviceClient = createServiceRoleClient();
  let generationReservation: AiUsageReservation | null = null;
  let generationDispatched = false;
  let generationTerminalRecorded = false;
  let generationReportedCostUsd: number | undefined;

  try {
    const result = await handleBrainChatRequest(
      {
        authorizationHeader: request.headers.get("authorization"),
        agentIdFromPath: agentId,
        rawMessages,
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
        retrieveKnowledge: (tenantId, queryText) =>
          retrieveKnowledge(tenantId, agentId, queryText, reservationMaterial),
        generate: async (messages, maxOutputTokens) => {
          if (generationReservation === null) throw new Error("AI usage reservation missing");
          generationDispatched = await markAiUsageInFlight(serviceClient, generationReservation);
          if (!generationDispatched) throw new Error("AI usage reservation is not executable");
          const generated = await port.generate({ model: providerModel, messages, maxOutputTokens });
          generationReportedCostUsd = generated.usage.reportedCostUsd;
          return generated;
        },
        logGenerationUsage: async (_tenantId, _agentId, inputTokens, outputTokens) => {
          if (generationReservation === null) throw new Error("AI usage reservation missing at commit");
          const committed = await commitAiUsage(serviceClient, generationReservation, {
            inputTokens,
            outputTokens,
            ...(generationReportedCostUsd === undefined ? {} : { reportedCostUsd: generationReportedCostUsd }),
          });
          if (!committed) {
            await markAiUsageUnknown(serviceClient, generationReservation, "usage_commit_failed");
            generationTerminalRecorded = true;
            throw new Error("AI usage commit failed after provider success");
          }
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
      // Degradação NUNCA pode parecer saúde na operação (Art. 16) — era um
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
      // checagem de código — isto não impede a fala, só dá visibilidade
      // real de quando o padrão de risco aparece na resposta gerada.
      // Nunca loga o conteúdo da fala em si (redação de PII/conversa).
      logEvent("brain_guardrail_risk_detected", { agent_id: agentId, flags: result.guardrailFlags.join(",") });
    }
    return new Response(buildCompletionStream(result.reply, model), {
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
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
