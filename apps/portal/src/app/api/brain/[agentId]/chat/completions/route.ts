import { NextRequest, NextResponse } from "next/server";

import { createUuidV7 } from "@axtro/domain";
import { createOpenRouterTextGenerationPort } from "@axtro/provider-openrouter";

import type { BrainKnowledgeMatch } from "@/lib/brain/chat-completion-core";
import type { BrainLanguage } from "@/lib/brain/metodo-silva";
import { BrainHttpError, handleBrainChatRequest, type BudgetVerdict, type ResolvedBrainAgent } from "@/lib/brain/handle-chat-request";
import { maybeAlertCostCap } from "@/lib/cost-alerts";
import { embedQuery } from "@/lib/knowledge";
import { createServiceRoleClient, ServiceRoleUnavailableError } from "@/lib/supabase/service";
import { logError as trackError, logEvent } from "@/lib/telemetry";

/**
 * Endpoint OpenAI-compatible que o Tavus chama como LLM da persona de vídeo
 * (`layers.llm.base_url`, M4-04). Wiring fino sobre `handleBrainChatRequest`
 * (puro e testado): resolve o segredo via service role (sem sessão de
 * usuário — chamada servidor-a-servidor), aplica teto diário de tokens e
 * rate limit, e formata a resposta em SSE `chat.completion.chunk`.
 */
export const dynamic = "force-dynamic";

/** Mesmo teto do sandbox de chat (agent-preview.ts) — um orçamento por tenant, não por superfície. */
const DAILY_TOKEN_CAP = 500_000;

/**
 * Rate limit em memória por agente: uma call de vídeo real gera no máximo
 * um turno a cada poucos segundos — 40/min é folga generosa e ainda corta
 * um loop de script. Processo único no Railway; se um dia houver réplicas,
 * isto vira melhor-esforço por instância (o teto diário de tokens continua
 * sendo a proteção dura de gasto).
 */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 40;
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
  requestTimestampsByAgent.set(agentId, timestamps);
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
 * Teto diário de tokens por tenant, lido do ledger real (cost_events) via
 * service role com filtro EXPLÍCITO de tenant (contrato do service.ts).
 * Falha-fechada: erro de leitura → "unavailable" → o núcleo degrada sem
 * gerar (auditoria 2026-08-02: antes não havia teto nenhum neste caminho).
 */
async function checkBudget(tenantId: string): Promise<BudgetVerdict> {
  const supabase = createServiceRoleClient();
  const startOfDayIso = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z").toISOString();
  const { data, error } = await supabase
    .from("cost_events")
    .select("quantity")
    .eq("tenant_id", tenantId)
    .eq("unit_type", "token")
    .gte("occurred_at", startOfDayIso);
  if (error || !Array.isArray(data)) return "unavailable";
  const total = data.reduce((sum, row) => sum + Number((row as { quantity: unknown }).quantity ?? 0), 0);
  // Alerta proativo (D-V2-107): fire-and-forget, mesmo ponto que já lê o uso do dia.
  void maybeAlertCostCap({ tenantId, capKind: "daily_tokens", current: total, cap: DAILY_TOKEN_CAP });
  return total >= DAILY_TOKEN_CAP ? "exhausted" : "allowed";
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
 * GAP DECLARADO E ACEITO (Art. 16): o custo da chamada de embedding desta
 * busca NÃO entra no ledger (`cost_events`) — ao contrário do caminho de
 * chat, que loga via `portal.knowledge_retrieval`. `portal_log_ai_usage_service`
 * (0019) tem preço fixo de chat (Haiku), não de embedding; adicionar um
 * parâmetro de serviço exigiria DROP+CREATE numa função já em produção
 * (risco real, lição de D-V2-103) por um ganho de precisão irrelevante — uma
 * query de busca é ~30-100 tokens a US$0,02/1M, fração de centavo por
 * conversa, já dominado pelo piso Tavus (US$0,175/conversa). Mesmo espírito
 * de "custo por conversa é piso, não exato" já aceito no projeto inteiro.
 */
async function retrieveKnowledge(tenantId: string, queryText: string): Promise<readonly BrainKnowledgeMatch[]> {
  const trimmed = queryText.trim();
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  if (trimmed.length === 0 || apiKey.trim().length === 0) return [];

  try {
    const { embedding } = await embedQuery(apiKey, trimmed);
    const supabase = createServiceRoleClient();
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
    trackError("brain_knowledge_retrieval_failed", error, { tenant_id: tenantId });
    return [];
  }
}

async function logGenerationUsage(tenantId: string, agentId: string, inputTokens: number, outputTokens: number): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase.rpc("portal_log_ai_usage_service", {
      p_tenant_id: tenantId,
      p_id: createUuidV7(),
      p_input_tokens: inputTokens,
      p_output_tokens: outputTokens,
    });
    if (error) trackError("brain_log_usage_failed", error, { agent_id: agentId });
  } catch (error) {
    trackError("brain_log_usage_failed", error, { agent_id: agentId });
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

  if (isRateLimited(agentId)) {
    logEvent("brain_rate_limited", { agent_id: agentId });
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }
  const rawMessages = (body as { messages?: unknown } | null)?.messages;
  const model = typeof (body as { model?: unknown } | null)?.model === "string"
    ? (body as { model: string }).model
    : "axtro-digital-human-os-brain";

  const port = createOpenRouterTextGenerationPort({
    apiKey,
    appUrl: "https://portal-production-b43e.up.railway.app",
    appTitle: "Axtro Digital Human OS — Brain",
  });

  try {
    const result = await handleBrainChatRequest(
      {
        authorizationHeader: request.headers.get("authorization"),
        agentIdFromPath: agentId,
        rawMessages,
      },
      {
        resolveConfig,
        checkBudget,
        retrieveKnowledge,
        generate: (messages, maxOutputTokens) =>
          port.generate({ model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-haiku-4.5", messages, maxOutputTokens }),
        logGenerationUsage,
      },
    );
    if (result.degraded) {
      // Degradação NUNCA pode parecer saúde na operação (Art. 16) — era um
      // catch vazio; agora todo fallback vira telemetria com o motivo real.
      if (result.degradedReason === "generation_failed" || result.degradedReason === "malformed_request") {
        trackError(`brain_degraded_${result.degradedReason}`, result.cause ?? new Error(result.degradedReason), { agent_id: agentId });
      } else {
        logEvent(`brain_degraded_${result.degradedReason ?? "unknown"}`, { agent_id: agentId });
      }
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
